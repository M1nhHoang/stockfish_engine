/**
 * UCI (Universal Chess Interface) engine wrapper for Node.js.
 *
 * Provides the UciEngine class to communicate with any UCI-compatible
 * chess engine (Stockfish, Leela Chess Zero, Komodo, etc.) via stdin/stdout.
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const readline = require('readline');

class EngineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * Communicates with a UCI-protocol compatible chess engine via stdin/stdout.
 *
 * Tested with: Stockfish 11, and compatible with any engine
 * following the UCI protocol specification.
 */
class UciEngine extends EventEmitter {
  /**
   * @param {string} enginePath - Path to the engine executable.
   * @param {string} [workingDir] - Working directory for the engine process.
   *   Defaults to the directory containing enginePath.
   */
  constructor(enginePath, workingDir) {
    super();
    this.enginePath = path.resolve(enginePath);
    this.workingDir = workingDir || path.dirname(this.enginePath);

    this._proc = null;
    this._rl = null;
    this._lineQueue = [];
    this._lineResolvers = [];
    this._running = false;
    this._debugCallback = null;

    /** Engine identity info, populated after start(). */
    this.id = { name: null, author: null };

    /** Available engine options, populated after start(). */
    this.options = {};
  }

  // ══════════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ══════════════════════════════════════════════════════════════════

  /**
   * Launch the engine process and initialize UCI handshake.
   *
   * @returns {Promise<boolean>} True if the engine responded with uciok.
   * @throws {Error} If engine file does not exist.
   */
  async start() {
    if (!fs.existsSync(this.enginePath)) {
      throw new Error(`Engine not found: ${this.enginePath}`);
    }

    if (this._proc) {
      await this.stop();
    }

    this._lineQueue = [];
    this._lineResolvers = [];

    this._proc = spawn(this.enginePath, [], {
      cwd: this.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._running = true;

    this._rl = readline.createInterface({ input: this._proc.stdout });
    this._rl.on('line', (line) => this._onLine(line));

    this._proc.stderr.on('data', (data) => {
      if (this._debugCallback) {
        this._debugCallback(`[stderr] ${data.toString().trim()}`);
      }
    });

    this._proc.on('close', (code) => {
      this._running = false;
      this.emit('close', code);
    });

    this._proc.on('error', (err) => {
      this._running = false;
      this.emit('error', err);
    });

    // UCI handshake
    this._send('uci');
    const result = await this._waitFor('uciok');

    // Parse id and options from handshake lines
    for (const line of result.lines) {
      if (line.startsWith('id name ')) {
        this.id.name = line.slice(8);
      } else if (line.startsWith('id author ')) {
        this.id.author = line.slice(10);
      } else if (line.startsWith('option name ')) {
        this._parseOption(line);
      }
    }

    return true;
  }

  /**
   * Send 'quit' and terminate the engine process.
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._proc) {
      try {
        this._send('quit');
      } catch (_) {
        // ignore write errors on already-closed process
      }

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (this._proc) {
            this._proc.kill('SIGKILL');
          }
          resolve();
        }, 2000);

        if (this._proc) {
          this._proc.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
        } else {
          clearTimeout(timer);
          resolve();
        }

        this._proc = null;
        this._rl = null;
        this._running = false;
      });
    }
  }

  /**
   * Check if the engine process is running.
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  // ══════════════════════════════════════════════════════════════════
  //  CONFIGURATION
  // ══════════════════════════════════════════════════════════════════

  /**
   * Set a UCI option.
   *
   * @param {string} name - Option name (e.g., 'Threads', 'Hash', 'MultiPV').
   * @param {string|number|boolean} value - Option value.
   */
  setOption(name, value) {
    this._send(`setoption name ${name} value ${value}`);
  }

  /**
   * Set multiple options at once.
   *
   * @param {Object} options - Key-value pairs of options.
   * @example engine.configure({ Threads: 2, Hash: 128, MultiPV: 3 });
   */
  configure(options) {
    for (const [name, value] of Object.entries(options)) {
      this.setOption(name, value);
    }
  }

  /**
   * Send 'isready' and wait for 'readyok'.
   * Useful to ensure the engine has finished processing previous commands.
   *
   * @param {number} [timeout=10000] - Timeout in ms.
   * @returns {Promise<boolean>}
   */
  async isReady(timeout = 10000) {
    this._send('isready');
    await this._waitFor('readyok', timeout);
    return true;
  }

  /**
   * Send 'ucinewgame' to reset the engine for a new game.
   * @returns {Promise<boolean>}
   */
  async newGame() {
    this._send('ucinewgame');
    return this.isReady();
  }

  // ══════════════════════════════════════════════════════════════════
  //  POSITION
  // ══════════════════════════════════════════════════════════════════

  /**
   * Set the board position from the starting position with optional moves.
   *
   * @param {string[]} [moves=[]] - Array of moves in UCI notation (e.g., ['e2e4', 'e7e5']).
   */
  setPosition(moves = []) {
    if (moves.length > 0) {
      this._send(`position startpos moves ${moves.join(' ')}`);
    } else {
      this._send('position startpos');
    }
  }

  /**
   * Set the board position from a FEN string with optional moves.
   *
   * @param {string} fen - FEN string.
   * @param {string[]} [moves=[]] - Array of moves in UCI notation.
   */
  setPositionFen(fen, moves = []) {
    if (moves.length > 0) {
      this._send(`position fen ${fen} moves ${moves.join(' ')}`);
    } else {
      this._send(`position fen ${fen}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  SEARCH / GO
  // ══════════════════════════════════════════════════════════════════

  /**
   * Start the engine search and return the best move.
   *
   * @param {Object} [params={}] - Search parameters.
   * @param {number} [params.depth] - Search to this depth (plies).
   * @param {number} [params.movetime] - Search for exactly this many ms.
   * @param {number} [params.nodes] - Search this many nodes only.
   * @param {number} [params.wtime] - White's remaining time (ms).
   * @param {number} [params.btime] - Black's remaining time (ms).
   * @param {number} [params.winc] - White's increment per move (ms).
   * @param {number} [params.binc] - Black's increment per move (ms).
   * @param {number} [params.movestogo] - Moves until next time control.
   * @param {boolean} [params.infinite] - Search until 'stop' is sent.
   * @param {string[]} [params.searchmoves] - Restrict search to these moves.
   * @param {number} [timeout=30000] - Maximum time to wait for bestmove (ms). 0 = no timeout.
   * @returns {Promise<{bestmove: string, ponder: string|null, info: Object[]}>}
   */
  async go(params = {}, timeout = 30000) {
    const parts = ['go'];

    if (params.depth != null) parts.push('depth', params.depth);
    if (params.movetime != null) parts.push('movetime', params.movetime);
    if (params.nodes != null) parts.push('nodes', params.nodes);
    if (params.wtime != null) parts.push('wtime', params.wtime);
    if (params.btime != null) parts.push('btime', params.btime);
    if (params.winc != null) parts.push('winc', params.winc);
    if (params.binc != null) parts.push('binc', params.binc);
    if (params.movestogo != null) parts.push('movestogo', params.movestogo);
    if (params.infinite) parts.push('infinite');
    if (params.searchmoves && params.searchmoves.length > 0) {
      parts.push('searchmoves', ...params.searchmoves);
    }

    this._send(parts.join(' '));
    const result = await this._waitFor('bestmove', timeout);

    // Parse bestmove line
    const bestmoveLine = result.match;
    const bmMatch = bestmoveLine.match(/^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/);

    // Collect info lines
    const infoLines = result.lines
      .filter((l) => l.startsWith('info '))
      .map((l) => this._parseInfo(l));

    return {
      bestmove: bmMatch ? bmMatch[1] : null,
      ponder: bmMatch && bmMatch[2] ? bmMatch[2] : null,
      info: infoLines,
    };
  }

  /**
   * Convenience: search by depth and return best move string.
   *
   * @param {number} depth - Search depth in plies.
   * @param {number} [timeout=30000] - Timeout in ms.
   * @returns {Promise<string>} Best move in UCI notation (e.g., 'e2e4').
   */
  async goDepth(depth, timeout = 30000) {
    const result = await this.go({ depth }, timeout);
    return result.bestmove;
  }

  /**
   * Convenience: search by time and return best move string.
   *
   * @param {number} movetime - Time to search in ms.
   * @param {number} [timeout=0] - Timeout in ms. 0 = movetime + 5s.
   * @returns {Promise<string>} Best move in UCI notation.
   */
  async goMovetime(movetime, timeout = 0) {
    const effectiveTimeout = timeout || movetime + 5000;
    const result = await this.go({ movetime }, effectiveTimeout);
    return result.bestmove;
  }

  /**
   * Stop the engine search immediately (for infinite/ponder searches).
   */
  stopSearch() {
    this._send('stop');
  }

  /**
   * Tell the engine to ponder on the expected reply.
   */
  ponderHit() {
    this._send('ponderhit');
  }

  // ══════════════════════════════════════════════════════════════════
  //  DEBUG CALLBACK
  // ══════════════════════════════════════════════════════════════════

  /**
   * Register a callback to receive engine output lines.
   * @param {function(string): void} callback
   */
  onDebug(callback) {
    this._debugCallback = callback;
  }

  // ══════════════════════════════════════════════════════════════════
  //  INTERNALS
  // ══════════════════════════════════════════════════════════════════

  _send(command) {
    if (!this._proc || !this._proc.stdin.writable) {
      throw new EngineError('Engine process is not running');
    }
    if (this._debugCallback) {
      this._debugCallback(`>> ${command}`);
    }
    this._proc.stdin.write(command + '\n');
  }

  _onLine(line) {
    line = line.trim();
    if (!line) return;

    if (this._debugCallback) {
      this._debugCallback(`<< ${line}`);
    }

    if (this._lineResolvers.length > 0) {
      this._lineQueue.push(line);
      this._checkResolvers();
    } else {
      // Emit for listeners even when not actively waiting
      this.emit('line', line);
    }
  }

  _checkResolvers() {
    if (this._lineResolvers.length === 0) return;

    const { keyword, resolve, lines } = this._lineResolvers[0];

    // Move all queued lines to collected lines, check for match
    while (this._lineQueue.length > 0) {
      const line = this._lineQueue.shift();
      lines.push(line);

      if (line.startsWith(keyword)) {
        const resolver = this._lineResolvers.shift();
        if (resolver.timer) clearTimeout(resolver.timer);
        resolve({ match: line, lines });
        return;
      }
    }
  }

  /**
   * Wait for a line starting with the given keyword.
   * Collects all intermediate lines.
   *
   * @param {string} keyword - The keyword to wait for (e.g., 'uciok', 'readyok', 'bestmove').
   * @param {number} [timeout=10000] - Timeout in ms. 0 = no timeout.
   * @returns {Promise<{match: string, lines: string[]}>}
   */
  _waitFor(keyword, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const entry = { keyword, resolve, lines: [], timer: null };

      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          const idx = this._lineResolvers.indexOf(entry);
          if (idx >= 0) this._lineResolvers.splice(idx, 1);
          reject(new EngineError(`Timeout waiting for '${keyword}' after ${timeout}ms`));
        }, timeout);
      }

      this._lineResolvers.push(entry);
      this._checkResolvers();
    });
  }

  /**
   * Parse a UCI 'option' line from the handshake.
   * @param {string} line
   */
  _parseOption(line) {
    // option name Hash type spin default 16 min 1 max 33554432
    const nameMatch = line.match(/^option name (.+?) type (\w+)/);
    if (!nameMatch) return;

    const name = nameMatch[1];
    const type = nameMatch[2];
    const opt = { type };

    if (type === 'spin') {
      const def = line.match(/default (\S+)/);
      const min = line.match(/min (\S+)/);
      const max = line.match(/max (\S+)/);
      if (def) opt.default = parseInt(def[1], 10);
      if (min) opt.min = parseInt(min[1], 10);
      if (max) opt.max = parseInt(max[1], 10);
    } else if (type === 'check') {
      const def = line.match(/default (\S+)/);
      if (def) opt.default = def[1] === 'true';
    } else if (type === 'string') {
      const def = line.match(/default (.*)/);
      if (def) opt.default = def[1].trim();
    } else if (type === 'combo') {
      const def = line.match(/default (\S+)/);
      if (def) opt.default = def[1];
      const vars = [];
      const varRegex = /var (\S+)/g;
      let m;
      while ((m = varRegex.exec(line)) !== null) {
        vars.push(m[1]);
      }
      opt.vars = vars;
    }

    this.options[name] = opt;
  }

  /**
   * Parse a UCI 'info' line into an object.
   * @param {string} line
   * @returns {Object}
   */
  _parseInfo(line) {
    const info = {};
    const tokens = line.split(/\s+/);
    let i = 1; // skip 'info'

    while (i < tokens.length) {
      const key = tokens[i];
      switch (key) {
        case 'depth':
        case 'seldepth':
        case 'multipv':
        case 'nodes':
        case 'nps':
        case 'time':
        case 'hashfull':
        case 'tbhits':
        case 'currmovenum':
          info[key] = parseInt(tokens[++i], 10);
          break;
        case 'score':
          i++;
          if (tokens[i] === 'cp') {
            info.score = { type: 'cp', value: parseInt(tokens[++i], 10) };
          } else if (tokens[i] === 'mate') {
            info.score = { type: 'mate', value: parseInt(tokens[++i], 10) };
          }
          break;
        case 'pv':
          info.pv = tokens.slice(i + 1);
          i = tokens.length; // pv is the rest of the line
          break;
        case 'currmove':
        case 'string':
          info[key] = tokens[++i];
          break;
        default:
          break;
      }
      i++;
    }
    return info;
  }
}

module.exports = { UciEngine, EngineError };

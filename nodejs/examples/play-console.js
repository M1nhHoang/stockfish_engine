/**
 * Example: Play chess in the console against the Stockfish engine.
 *
 * Usage:
 *   node play-console.js
 *
 * Requirements:
 *   - Stockfish binary must be in the engine/ folder.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const readlineModule = require('readline');
const { UciEngine } = require('../src/uci-engine');

// Auto-detect platform and resolve engine path
function getEnginePath() {
  const engineDir = path.join(__dirname, '..', '..', 'engine');
  if (process.platform === 'win32') {
    return path.join(engineDir, 'stockfish-windows-x86-64.exe');
  } else if (process.platform === 'darwin') {
    return path.join(engineDir, 'stockfish-macos-x86-64');
  } else {
    return path.join(engineDir, 'stockfish-ubuntu-x86-64');
  }
}

const ENGINE_PATH = getEnginePath();

const PIECES = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

function parseFen(fen) {
  const board = [];
  const rows = fen.split(' ')[0].split('/');
  for (const row of rows) {
    const boardRow = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < parseInt(ch, 10); i++) boardRow.push('.');
      } else {
        boardRow.push(ch);
      }
    }
    board.push(boardRow);
  }
  return board;
}

function showBoard(fen) {
  const board = parseFen(fen);
  console.log();
  console.log('    a   b   c   d   e   f   g   h');
  console.log('  ┌───┬───┬───┬───┬───┬───┬───┬───┐');
  for (let r = 0; r < 8; r++) {
    const row = board[r]
      .map((p) => (p === '.' ? ' ' : (PIECES[p] || p)))
      .join(' │ ');
    console.log(`${8 - r} │ ${row} │ ${8 - r}`);
    if (r < 7) {
      console.log('  ├───┼───┼───┼───┼───┼───┼───┼───┤');
    }
  }
  console.log('  └───┴───┴───┴───┴───┴───┴───┴───┘');
  console.log('    a   b   c   d   e   f   g   h');
  console.log();
}

function applyMove(fen, move) {
  // Simplified: we track position via moves list, so just update FEN externally
  // In a real app, use a chess library for proper FEN tracking
  return fen;
}

async function main() {
  if (!fs.existsSync(ENGINE_PATH)) {
    console.log(`Engine not found at: ${ENGINE_PATH}`);
    console.log('Please download Stockfish and place the binary in the engine/ folder.');
    console.log('Download: https://stockfishchess.org/download/');
    return;
  }

  const engine = new UciEngine(ENGINE_PATH);
  await engine.start();
  console.log(`Engine: ${engine.id.name} by ${engine.id.author}`);

  engine.configure({ Threads: 1, Hash: 64 });
  await engine.newGame();

  const rl = readlineModule.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  const moves = [];
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let playerColor = 'w'; // Player is white by default

  console.log('\n♚ Chess Console ♚');
  console.log('Enter moves in UCI notation (e.g., e2e4, g1f3, e1g1 for castling)');
  console.log('Commands: quit, new, fen, hint\n');

  const colorChoice = await ask('Play as (w)hite or (b)lack? [w]: ');
  if (colorChoice.toLowerCase() === 'b') {
    playerColor = 'b';
    console.log('You are Black. Engine plays first as White.\n');
  } else {
    console.log('You are White. You play first.\n');
  }

  showBoard(currentFen);

  // If player is black, engine moves first
  if (playerColor === 'b') {
    engine.setPosition(moves);
    const bestmove = await engine.goDepth(12);
    moves.push(bestmove);
    console.log(`Engine plays: ${bestmove}`);
    // We can't easily update FEN without a chess library, so just show moves
    console.log(`Moves so far: ${moves.join(' ')}\n`);
  }

  while (true) {
    const input = await ask('Your move: ');
    const cmd = input.trim().toLowerCase();

    if (cmd === 'quit' || cmd === 'exit') {
      break;
    }

    if (cmd === 'new') {
      moves.length = 0;
      currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      await engine.newGame();
      showBoard(currentFen);
      console.log('New game started.\n');
      continue;
    }

    if (cmd === 'fen') {
      console.log(`Moves: ${moves.join(' ')}\n`);
      continue;
    }

    if (cmd === 'hint') {
      engine.setPosition(moves);
      const hint = await engine.goDepth(12);
      console.log(`Hint: ${hint}\n`);
      continue;
    }

    // Validate basic move format (e.g., e2e4, e7e8q)
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(cmd)) {
      console.log('Invalid format. Use UCI notation: e2e4, g1f3, e7e8q\n');
      continue;
    }

    // Player's move
    moves.push(cmd);
    console.log(`You play: ${cmd}`);

    // Engine's response
    engine.setPosition(moves);
    const result = await engine.go({ depth: 12 });
    const bestmove = result.bestmove;

    if (bestmove === '(none)' || !bestmove) {
      console.log('Game over! No legal moves.');
      break;
    }

    moves.push(bestmove);

    // Show evaluation
    const lastInfo = result.info.length > 0 ? result.info[result.info.length - 1] : null;
    let evalStr = '';
    if (lastInfo && lastInfo.score) {
      if (lastInfo.score.type === 'cp') {
        const cp = lastInfo.score.value / 100;
        evalStr = ` (eval: ${cp > 0 ? '+' : ''}${cp.toFixed(2)})`;
      } else if (lastInfo.score.type === 'mate') {
        evalStr = ` (mate in ${lastInfo.score.value})`;
      }
    }

    console.log(`Engine plays: ${bestmove}${evalStr}`);
    console.log(`Moves so far: ${moves.join(' ')}\n`);
  }

  rl.close();
  await engine.stop();
  console.log('Goodbye!');
}

main().catch(console.error);

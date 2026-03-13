"""
UCI (Universal Chess Interface) engine wrapper for Python.

Provides the UciEngine class to communicate with any UCI-compatible
chess engine (Stockfish, Leela Chess Zero, Komodo, etc.) via stdin/stdout.
"""

import os
import re
import subprocess
import threading
import queue
import platform
from enum import IntEnum


class EngineError(Exception):
    """Raised when the engine encounters an error."""
    pass


class UciEngine:
    """
    Communicates with a UCI-protocol compatible chess engine via stdin/stdout.

    Tested with: Stockfish 15.1, and compatible with any engine
    following the UCI protocol specification.

    Usage:
        with UciEngine("path/to/stockfish") as engine:
            engine.start()
            engine.configure(Threads=2, Hash=128)
            engine.set_position(["e2e4", "e7e5"])
            result = engine.go(depth=15)
            print(result["bestmove"])  # e.g., "g1f3"
    """

    def __init__(self, engine_path, working_dir=None):
        """
        Initialize the engine wrapper.

        Args:
            engine_path: Path to the engine executable.
            working_dir: Working directory for the engine process.
                Defaults to the directory containing the executable.
        """
        self.engine_path = os.path.abspath(engine_path)
        self.working_dir = working_dir or os.path.dirname(self.engine_path)

        self._proc = None
        self._reader_thread = None
        self._line_queue = queue.Queue()
        self._running = False
        self._debug_callback = None

        # Populated after start()
        self.id = {"name": None, "author": None}
        self.options = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stop()

    # ══════════════════════════════════════════════════════════════════
    #  LIFECYCLE
    # ══════════════════════════════════════════════════════════════════

    def start(self):
        """
        Launch the engine process and perform the UCI handshake.

        Returns:
            True if the engine responded with 'uciok'.

        Raises:
            FileNotFoundError: If the engine executable does not exist.
            EngineError: If the engine fails the UCI handshake.
        """
        if not os.path.isfile(self.engine_path):
            raise FileNotFoundError(f"Engine not found: {self.engine_path}")

        if self._proc:
            self.stop()

        self._proc = subprocess.Popen(
            [self.engine_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.working_dir,
            text=False,
        )

        self._running = True
        self._reader_thread = threading.Thread(
            target=self._read_stdout, daemon=True
        )
        self._reader_thread.start()

        # UCI handshake
        self._send("uci")
        lines = self._wait_for("uciok")

        for line in lines:
            if line.startswith("id name "):
                self.id["name"] = line[8:]
            elif line.startswith("id author "):
                self.id["author"] = line[10:]
            elif line.startswith("option name "):
                self._parse_option(line)

        return True

    def stop(self):
        """Send 'quit' and terminate the engine process."""
        if self._proc:
            try:
                self._send("quit")
            except Exception:
                pass

            self._running = False

            try:
                self._proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._proc.kill()

            self._proc = None

    @property
    def is_running(self):
        """Whether the engine process is alive."""
        return self._running and self._proc is not None

    # ══════════════════════════════════════════════════════════════════
    #  CONFIGURATION
    # ══════════════════════════════════════════════════════════════════

    def set_option(self, name, value):
        """
        Set a UCI option.

        Args:
            name: Option name (e.g., 'Threads', 'Hash', 'MultiPV').
            value: Option value.
        """
        self._send(f"setoption name {name} value {value}")

    def configure(self, **options):
        """
        Set multiple UCI options at once.

        Example:
            engine.configure(Threads=2, Hash=128, MultiPV=3)
        """
        for name, value in options.items():
            self.set_option(name, value)

    def is_ready(self, timeout=10):
        """
        Send 'isready' and wait for 'readyok'.

        Args:
            timeout: Timeout in seconds. 0 = no timeout.

        Returns:
            True when the engine is ready.
        """
        self._send("isready")
        self._wait_for("readyok", timeout=timeout)
        return True

    def new_game(self):
        """
        Send 'ucinewgame' to reset the engine for a new game.

        Returns:
            True when the engine is ready.
        """
        self._send("ucinewgame")
        return self.is_ready()

    # ══════════════════════════════════════════════════════════════════
    #  POSITION
    # ══════════════════════════════════════════════════════════════════

    def set_position(self, moves=None):
        """
        Set the board position from the starting position with optional moves.

        Args:
            moves: List of moves in UCI notation (e.g., ['e2e4', 'e7e5']).
        """
        if moves:
            self._send(f"position startpos moves {' '.join(moves)}")
        else:
            self._send("position startpos")

    def set_position_fen(self, fen, moves=None):
        """
        Set the board position from a FEN string with optional moves.

        Args:
            fen: FEN string.
            moves: List of moves in UCI notation.
        """
        if moves:
            self._send(f"position fen {fen} moves {' '.join(moves)}")
        else:
            self._send(f"position fen {fen}")

    # ══════════════════════════════════════════════════════════════════
    #  SEARCH / GO
    # ══════════════════════════════════════════════════════════════════

    def go(self, depth=None, movetime=None, nodes=None, wtime=None,
           btime=None, winc=None, binc=None, movestogo=None,
           infinite=False, searchmoves=None, timeout=30):
        """
        Start the engine search and return the result.

        Args:
            depth: Search to this depth (plies).
            movetime: Search for exactly this many milliseconds.
            nodes: Search this many nodes only.
            wtime: White's remaining time (ms).
            btime: Black's remaining time (ms).
            winc: White's increment per move (ms).
            binc: Black's increment per move (ms).
            movestogo: Moves until next time control.
            infinite: Search until stop() is called.
            searchmoves: Restrict search to these moves.
            timeout: Maximum time to wait for bestmove (seconds). 0 = no timeout.

        Returns:
            dict with keys:
                - bestmove (str): Best move in UCI notation (e.g., 'e2e4').
                - ponder (str|None): Suggested ponder move.
                - info (list[dict]): Search info lines.
        """
        parts = ["go"]

        if depth is not None:
            parts.extend(["depth", str(depth)])
        if movetime is not None:
            parts.extend(["movetime", str(movetime)])
        if nodes is not None:
            parts.extend(["nodes", str(nodes)])
        if wtime is not None:
            parts.extend(["wtime", str(wtime)])
        if btime is not None:
            parts.extend(["btime", str(btime)])
        if winc is not None:
            parts.extend(["winc", str(winc)])
        if binc is not None:
            parts.extend(["binc", str(binc)])
        if movestogo is not None:
            parts.extend(["movestogo", str(movestogo)])
        if infinite:
            parts.append("infinite")
        if searchmoves:
            parts.extend(["searchmoves"] + list(searchmoves))

        self._send(" ".join(parts))
        lines = self._wait_for("bestmove", timeout=timeout)

        # Parse bestmove
        bestmove_line = lines[-1]  # Last line is the bestmove
        bm_match = re.match(r"bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?", bestmove_line)

        # Collect info lines
        info_lines = [
            self._parse_info(l) for l in lines if l.startswith("info ")
        ]

        return {
            "bestmove": bm_match.group(1) if bm_match else None,
            "ponder": bm_match.group(2) if bm_match and bm_match.group(2) else None,
            "info": info_lines,
        }

    def go_depth(self, depth, timeout=30):
        """
        Convenience: search by depth and return the best move string.

        Args:
            depth: Search depth in plies.
            timeout: Timeout in seconds.

        Returns:
            Best move in UCI notation (e.g., 'e2e4').
        """
        result = self.go(depth=depth, timeout=timeout)
        return result["bestmove"]

    def go_movetime(self, movetime, timeout=0):
        """
        Convenience: search by time and return the best move string.

        Args:
            movetime: Time to search in milliseconds.
            timeout: Timeout in seconds. 0 = movetime/1000 + 5.

        Returns:
            Best move in UCI notation.
        """
        effective_timeout = timeout or (movetime / 1000 + 5)
        result = self.go(movetime=movetime, timeout=effective_timeout)
        return result["bestmove"]

    def stop_search(self):
        """Stop the engine search immediately (for infinite/ponder searches)."""
        self._send("stop")

    def ponder_hit(self):
        """Tell the engine the expected ponder move was played."""
        self._send("ponderhit")

    # ══════════════════════════════════════════════════════════════════
    #  DEBUG CALLBACK
    # ══════════════════════════════════════════════════════════════════

    def on_debug(self, callback):
        """
        Register a callback to receive engine I/O lines.

        Args:
            callback: Function that takes a single string argument.
        """
        self._debug_callback = callback

    # ══════════════════════════════════════════════════════════════════
    #  INTERNALS
    # ══════════════════════════════════════════════════════════════════

    def _send(self, command):
        if not self._proc or not self._proc.stdin:
            raise EngineError("Engine process is not running")
        if self._debug_callback:
            self._debug_callback(f">> {command}")
        self._proc.stdin.write((command + "\n").encode())
        self._proc.stdin.flush()

    def _read_stdout(self):
        """Background thread: read lines from engine stdout."""
        try:
            for raw in self._proc.stdout:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                if self._debug_callback:
                    self._debug_callback(f"<< {line}")
                self._line_queue.put(line)
        except Exception:
            pass

    def _read_line(self, timeout=None):
        """Read a single line from the queue."""
        try:
            return self._line_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def _wait_for(self, keyword, timeout=10):
        """
        Wait for a line starting with the given keyword.
        Returns all collected lines (including the matching line).

        Args:
            keyword: The keyword to wait for (e.g., 'uciok', 'readyok', 'bestmove').
            timeout: Timeout in seconds. 0 = no timeout.

        Returns:
            List of all lines collected until the keyword was found.
        """
        collected = []
        effective_timeout = timeout if timeout > 0 else None

        while True:
            line = self._read_line(timeout=effective_timeout)
            if line is None:
                raise EngineError(
                    f"Timeout waiting for '{keyword}' after {timeout}s"
                )
            collected.append(line)
            if line.startswith(keyword):
                return collected

    def _parse_option(self, line):
        """Parse a UCI 'option' line from the handshake."""
        name_match = re.match(r"option name (.+?) type (\w+)", line)
        if not name_match:
            return

        name = name_match.group(1)
        opt_type = name_match.group(2)
        opt = {"type": opt_type}

        if opt_type == "spin":
            for key in ("default", "min", "max"):
                m = re.search(rf"{key} (\S+)", line)
                if m:
                    opt[key] = int(m.group(1))
        elif opt_type == "check":
            m = re.search(r"default (\S+)", line)
            if m:
                opt["default"] = m.group(1) == "true"
        elif opt_type == "string":
            m = re.search(r"default (.*)", line)
            if m:
                opt["default"] = m.group(1).strip()
        elif opt_type == "combo":
            m = re.search(r"default (\S+)", line)
            if m:
                opt["default"] = m.group(1)
            opt["vars"] = re.findall(r"var (\S+)", line)

        self.options[name] = opt

    def _parse_info(self, line):
        """Parse a UCI 'info' line into a dict."""
        info = {}
        tokens = line.split()
        i = 1  # skip 'info'

        while i < len(tokens):
            key = tokens[i]
            if key in ("depth", "seldepth", "multipv", "nodes", "nps",
                       "time", "hashfull", "tbhits", "currmovenum"):
                i += 1
                info[key] = int(tokens[i])
            elif key == "score":
                i += 1
                if tokens[i] == "cp":
                    i += 1
                    info["score"] = {"type": "cp", "value": int(tokens[i])}
                elif tokens[i] == "mate":
                    i += 1
                    info["score"] = {"type": "mate", "value": int(tokens[i])}
            elif key == "pv":
                info["pv"] = tokens[i + 1:]
                break
            elif key in ("currmove", "string"):
                i += 1
                info[key] = tokens[i]
            i += 1

        return info

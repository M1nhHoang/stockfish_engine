# stockfish_engine (Python)

A Python module for integrating UCI chess engines (Stockfish or any UCI-compatible engine) into your applications.

## Installation

### Option 1: Copy directly
```python
from stockfish_engine import UciEngine
```

### Option 2: Install via pip (local)
```bash
cd path/to/python
pip install .
```

## Quick Start

```python
from stockfish_engine import UciEngine

with UciEngine("engine/stockfish-windows-x86-64.exe") as engine:
    engine.start()
    engine.configure(Threads=1, Hash=64)
    engine.new_game()

    # Set position and get best move
    engine.set_position(["e2e4", "e7e5"])
    bestmove = engine.go_depth(15)
    print(bestmove)  # e.g., "g1f3"
```

## API Reference

### `UciEngine(engine_path, working_dir=None)`

| Parameter | Description |
|---|---|
| `engine_path` | Path to the engine executable. |
| `working_dir` | Working directory. Defaults to the directory containing the executable. |

### Lifecycle

| Method | Description | Returns |
|---|---|---|
| `start()` | Launch engine and perform UCI handshake. | `True` if OK |
| `stop()` | Send `quit` and terminate the engine process. | – |
| `is_ready(timeout=10)` | Wait for engine to be ready. | `True` |
| `new_game()` | Reset for a new game. | `True` |
| `is_running` | Whether the engine process is alive. | `bool` |

### Configuration

```python
engine.configure(
    Threads=2,           # CPU threads
    Hash=128,            # Hash table size (MB)
    MultiPV=3,           # Number of best lines
)
```

Or set individual options:
```python
engine.set_option("Threads", 4)
engine.set_option("UCI_LimitStrength", "true")
engine.set_option("UCI_Elo", 1500)
```

### Position

```python
# From starting position with moves
engine.set_position(["e2e4", "e7e5", "g1f3"])

# From FEN string
engine.set_position_fen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1")

# FEN with additional moves
engine.set_position_fen("...fen...", moves=["e7e5"])
```

### Search

```python
# Full search with all info
result = engine.go(depth=15)
print(result["bestmove"])   # "g1f3"
print(result["ponder"])     # "b8c6" or None
print(result["info"])       # List of info dicts

# Convenience methods
bestmove = engine.go_depth(15)          # Search by depth
bestmove = engine.go_movetime(2000)     # Search for 2 seconds

# Time control
result = engine.go(wtime=60000, btime=60000, winc=1000, binc=1000)

# Stop infinite search
engine.go(infinite=True)
# ... later:
engine.stop_search()
```

### Search Result Info

Each `info` dict in `result["info"]` may contain:

| Key | Type | Description |
|---|---|---|
| `depth` | int | Search depth |
| `seldepth` | int | Selective search depth |
| `score` | dict | `{"type": "cp", "value": 35}` or `{"type": "mate", "value": 3}` |
| `nodes` | int | Nodes searched |
| `nps` | int | Nodes per second |
| `time` | int | Time spent (ms) |
| `pv` | list | Principal variation (list of moves) |
| `multipv` | int | Multi-PV line number |

### Debug Callback

```python
engine.on_debug(lambda line: print(f"[ENGINE] {line}"))
```

### Context Manager

```python
with UciEngine("engine/stockfish") as engine:
    engine.start()
    # ... play ...
# engine.stop() is called automatically
```

## Integration Examples

### Web API (FastAPI)

```python
from fastapi import FastAPI
from stockfish_engine import UciEngine

app = FastAPI()
engine = UciEngine("engine/stockfish-ubuntu-x86-64")
engine.start()
engine.configure(Threads=1, Hash=64)

@app.post("/move")
def get_move(fen: str):
    engine.set_position_fen(fen)
    result = engine.go(depth=15)
    return {"bestmove": result["bestmove"], "ponder": result["ponder"]}
```

## Important Notes

1. **Download Stockfish separately** from [stockfishchess.org](https://stockfishchess.org/download/).
2. **Make it executable** on Linux/macOS: `chmod +x stockfish-*`
3. **Don't send commands during search** — Wait for the result before the next command.
4. **For shared hosting**: Use `Threads=1`, `Hash=64` to respect resource limits.

# stockfish_engine

A cross-platform wrapper for UCI-protocol chess engines, designed for **[Stockfish](https://stockfishchess.org/)** — the strongest open-source chess engine in the world.

Available in **Python** and **Node.js**.

## Project Structure

```
stockfish_engine/
├── engine/                    # Stockfish binaries (download separately)
│   └── stockfish-windows-x86-64.exe
├── python/                    # Python wrapper
│   ├── stockfish_engine/
│   │   ├── __init__.py
│   │   ├── engine.py
│   │   └── examples/
│   │       └── play_console.py
│   ├── setup.py
│   └── pyproject.toml
└── nodejs/                    # Node.js wrapper
    ├── src/
    │   └── uci-engine.js
    ├── examples/
    │   └── play-console.js
    └── package.json
```

## Stockfish Download

Download the appropriate binary from [stockfishchess.org/download](https://stockfishchess.org/download/) and place it in the `engine/` folder.

### Included Version: **Stockfish 11**

Pre-compiled binaries are already included in the `engine/` folder:

| Platform | Binary Name | Size |
|----------|-------------|------|
| Windows | `stockfish-windows-x86-64.exe` | 3.3 MB |
| Linux | `stockfish-ubuntu-x86-64` | 0.4 MB |

> **Stockfish 11** is the last version before NNUE — pure classical evaluation, extremely lightweight.
>
> **For shared hosting (Vietnix, etc.):** These `x86-64` builds (SSE2 only) are designed for maximum compatibility.

## UCI Protocol Overview

Stockfish uses the **UCI (Universal Chess Interface)** protocol — an industry standard for chess engine communication:

| Command | Response | Description |
|---------|----------|-------------|
| `uci` | `uciok` | Initialize UCI mode, get engine info |
| `isready` | `readyok` | Ping — ensure engine is ready |
| `ucinewgame` | — | Reset for a new game |
| `position startpos moves e2e4 e7e5` | — | Set board position |
| `position fen <fen>` | — | Set position from FEN string |
| `go depth 15` | `bestmove e2e4` | Search at depth 15 |
| `go movetime 2000` | `bestmove e2e4` | Search for 2 seconds |
| `go wtime 60000 btime 60000` | `bestmove e2e4` | Search with time control |
| `stop` | `bestmove ...` | Stop search immediately |
| `quit` | — | Exit the engine |

### Move Notation (UCI)

Moves are in **coordinate notation**: `<from><to>[promotion]`

| Move | Description |
|------|-------------|
| `e2e4` | Pawn e2 to e4 |
| `g1f3` | Knight g1 to f3 |
| `e1g1` | King-side castling (White) |
| `e1c1` | Queen-side castling (White) |
| `e7e8q` | Pawn promotion to queen |


## Quick Start

### Python

```python
from stockfish_engine import UciEngine

with UciEngine("engine/stockfish-windows-x86-64.exe") as engine:
    engine.start()
    engine.configure(Threads=2, Hash=128)
    engine.new_game()

    engine.set_position(["e2e4", "e7e5"])
    result = engine.go(depth=15)
    print(result["bestmove"])   # e.g., "g1f3"
    print(result["ponder"])     # e.g., "b8c6"
```

See [python/README.md](python/README.md) for full documentation.

### Node.js

```js
const { UciEngine } = require('./nodejs/src/uci-engine');

const engine = new UciEngine('engine/stockfish-windows-x86-64.exe');
await engine.start();
engine.configure({ Threads: 2, Hash: 128 });
await engine.newGame();

engine.setPosition(['e2e4', 'e7e5']);
const result = await engine.go({ depth: 15 });
console.log(result.bestmove);  // e.g., "g1f3"
await engine.stop();
```

See [nodejs/README.md](nodejs/README.md) for full documentation.

## Common Stockfish Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `Threads` | spin | 1 | Number of CPU threads (1–512) |
| `Hash` | spin | 16 | Hash table size in MB (1–33554432) |
| `MultiPV` | spin | 1 | Number of best lines to output (1–500) |
| `Skill Level` | spin | 20 | Engine strength (0=weakest, 20=strongest) |
| `Move Overhead` | spin | 10 | Buffer time in ms for network/GUI lag |
| `UCI_LimitStrength` | check | false | Enable Elo-limited play |
| `UCI_Elo` | spin | 1320 | Target Elo when LimitStrength is on (1320–3190) |
| `Ponder` | check | false | Think during opponent's turn |

### Adjusting Difficulty

```python
# Beginner level (~1500 Elo)
engine.configure(UCI_LimitStrength="true", UCI_Elo=1500)

# Intermediate (~2000 Elo)
engine.configure(UCI_LimitStrength="true", UCI_Elo=2000)

# Full strength (default)
engine.configure(Threads=4, Hash=256)
```

## Important Notes

1. **Stockfish is not included.** Download it separately from [stockfishchess.org](https://stockfishchess.org/download/).
2. **Binary must be executable.** On Linux/macOS, run `chmod +x stockfish-*` after downloading.
3. **No data files needed.** Unlike Gomoku engines, Stockfish is self-contained — the neural network (NNUE) is embedded in the binary since Stockfish 16+.
4. **Threads and Hash** — For shared hosting, use `Threads=1` and `Hash=64` to stay within resource limits.
5. **Don't send commands during search** — Wait for `bestmove` before sending new commands, unless sending `stop`.

## License

This wrapper module is released under the MIT license.
Stockfish is licensed under the [GNU General Public License v3](https://www.gnu.org/licenses/gpl-3.0.html).

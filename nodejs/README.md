# uci-engine (Node.js)

A Node.js module for integrating UCI chess engines (Stockfish or any UCI-compatible engine) into your applications.

## Installation

### Option 1: Copy directly
```js
const { UciEngine } = require('./path/to/uci-engine/src/uci-engine');
```

### Option 2: npm link
```bash
cd path/to/nodejs
npm link
# Then in your project:
npm link uci-engine
```

## Quick Start

```js
const { UciEngine } = require('uci-engine');

async function main() {
  const engine = new UciEngine('engine/stockfish-windows-x86-64.exe');
  await engine.start();
  engine.configure({ Threads: 1, Hash: 64 });
  await engine.newGame();

  engine.setPosition(['e2e4', 'e7e5']);
  const bestmove = await engine.goDepth(15);
  console.log(bestmove);  // e.g., "g1f3"

  await engine.stop();
}

main().catch(console.error);
```

## API Reference

### `new UciEngine(enginePath, workingDir?)`

| Parameter | Description |
|---|---|
| `enginePath` | Path to the engine executable. |
| `workingDir` | Working directory. Defaults to the directory containing the executable. |

### Lifecycle

| Method | Description | Returns |
|---|---|---|
| `start()` | Launch engine and perform UCI handshake. | `Promise<boolean>` |
| `stop()` | Send `quit` and terminate. | `Promise<void>` |
| `isReady(timeout?)` | Wait for engine to be ready. | `Promise<boolean>` |
| `newGame()` | Reset for a new game. | `Promise<boolean>` |
| `isRunning` | Whether the engine process is alive. | `boolean` (getter) |

### Properties (after `start()`)

| Property | Type | Description |
|---|---|---|
| `id.name` | string | Engine name (e.g., "Stockfish 11 64") |
| `id.author` | string | Engine author |
| `options` | Object | Available UCI options with types and defaults |

### Configuration

```js
engine.configure({
  Threads: 2,
  Hash: 128,
  MultiPV: 3,
  'Skill Level': 10,
});

// Or individual options:
engine.setOption('Threads', 4);
engine.setOption('UCI_LimitStrength', 'true');
engine.setOption('UCI_Elo', 1500);
```

### Position

```js
// From starting position with moves
engine.setPosition(['e2e4', 'e7e5', 'g1f3']);

// From FEN string
engine.setPositionFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');

// FEN with additional moves
engine.setPositionFen('...fen...', ['e7e5']);
```

### Search

```js
// Full search with all info
const result = await engine.go({ depth: 15 });
console.log(result.bestmove);  // "g1f3"
console.log(result.ponder);    // "b8c6" or null
console.log(result.info);      // Array of info objects

// Convenience methods
const bestmove = await engine.goDepth(15);         // Search by depth
const bestmove2 = await engine.goMovetime(2000);   // Search for 2 seconds

// Time control
const result2 = await engine.go({
  wtime: 60000, btime: 60000,
  winc: 1000, binc: 1000,
});

// Stop infinite search
engine.go({ infinite: true });
// ... later:
engine.stopSearch();
```

### Debug Callback

```js
engine.onDebug((line) => console.log(`[ENGINE] ${line}`));
```

## Integration Examples

### Express Web API

```js
const express = require('express');
const { UciEngine } = require('uci-engine');

const app = express();
app.use(express.json());

const engine = new UciEngine('engine/stockfish-ubuntu-x86-64');

(async () => {
  await engine.start();
  engine.configure({ Threads: 1, Hash: 64 });

  app.post('/move', async (req, res) => {
    const { fen } = req.body;
    engine.setPositionFen(fen);
    const result = await engine.go({ depth: 15 });
    res.json({ bestmove: result.bestmove, ponder: result.ponder });
  });

  app.listen(3000, () => console.log('Chess API on port 3000'));
})();
```

## Module Structure

```
nodejs/
├── src/
│   └── uci-engine.js       # Core wrapper class (UciEngine, EngineError)
├── examples/
│   └── play-console.js     # Interactive console chess game
└── package.json
```

## Important Notes

1. **Download Stockfish separately** from [stockfishchess.org](https://stockfishchess.org/download/).
2. **Node.js >= 14** — Uses `child_process.spawn`, `readline`, and modern JS features.
3. **Don't send commands during search** — Wait for the result or call `stopSearch()` first.
4. **For shared hosting**: Use `Threads: 1`, `Hash: 64` to respect resource limits.

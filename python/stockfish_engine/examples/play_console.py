"""
Example: Play chess in the console against the Stockfish engine.

Usage:
    python play_console.py

Requirements:
    - Stockfish binary must be in the engine/ folder.
"""

import os
import sys
import platform
import re

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from stockfish_engine import UciEngine


INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

PIECES = {
    "P": "♙", "N": "♘", "B": "♗", "R": "♖", "Q": "♕", "K": "♔",
    "p": "♟", "n": "♞", "b": "♝", "r": "♜", "q": "♛", "k": "♚",
}


def get_engine_path():
    """Auto-detect platform and return the appropriate Stockfish binary path."""
    engine_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",  # examples/
        "..",  # stockfish_engine/
        "..",  # python/
        "engine",
    )
    system = platform.system()
    if system == "Windows":
        return os.path.join(engine_dir, "stockfish-windows-x86-64.exe")
    elif system == "Darwin":
        return os.path.join(engine_dir, "stockfish-macos-x86-64")
    else:
        return os.path.join(engine_dir, "stockfish-ubuntu-x86-64")


def show_board(fen):
    """Display the chess board from a FEN string."""
    board_str = fen.split(" ")[0]
    rows = board_str.split("/")

    print()
    print("    a   b   c   d   e   f   g   h")
    print("  ┌───┬───┬───┬───┬───┬───┬───┬───┐")

    for r, row_str in enumerate(rows):
        cells = []
        for ch in row_str:
            if ch.isdigit():
                cells.extend([" "] * int(ch))
            else:
                cells.append(PIECES.get(ch, ch))

        row_display = " │ ".join(cells)
        print(f"{8 - r} │ {row_display} │ {8 - r}")
        if r < 7:
            print("  ├───┼───┼───┼───┼───┼───┼───┼───┤")

    print("  └───┴───┴───┴───┴───┴───┴───┴───┘")
    print("    a   b   c   d   e   f   g   h")
    print()


def main():
    engine_path = get_engine_path()

    if not os.path.isfile(engine_path):
        print(f"Engine not found at: {engine_path}")
        print("Please download Stockfish and place the binary in the engine/ folder.")
        print("Download: https://stockfishchess.org/download/")
        return

    with UciEngine(engine_path) as engine:
        engine.start()
        print(f"Engine: {engine.id['name']} by {engine.id['author']}")

        engine.configure(Threads=1, Hash=64)
        engine.new_game()

        moves = []

        print("\n♚ Chess Console ♚")
        print("Enter moves in UCI notation (e.g., e2e4, g1f3, e1g1 for castling)")
        print("Commands: quit, new, moves, hint\n")

        color = input("Play as (w)hite or (b)lack? [w]: ").strip().lower()
        player_is_black = color == "b"

        if player_is_black:
            print("You are Black. Engine plays first as White.\n")
        else:
            print("You are White. You play first.\n")

        show_board(INITIAL_FEN)

        # Engine moves first if player is black
        if player_is_black:
            engine.set_position(moves)
            bestmove = engine.go_depth(12)
            moves.append(bestmove)
            print(f"Engine plays: {bestmove}")
            print(f"Moves so far: {' '.join(moves)}\n")

        while True:
            try:
                user_input = input("Your move: ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                break

            if user_input in ("quit", "exit"):
                break

            if user_input == "new":
                moves.clear()
                engine.new_game()
                show_board(INITIAL_FEN)
                print("New game started.\n")
                continue

            if user_input == "moves":
                print(f"Moves: {' '.join(moves)}\n")
                continue

            if user_input == "hint":
                engine.set_position(moves)
                hint = engine.go_depth(12)
                print(f"Hint: {hint}\n")
                continue

            # Validate basic move format
            if not re.match(r"^[a-h][1-8][a-h][1-8][qrbn]?$", user_input):
                print("Invalid format. Use UCI notation: e2e4, g1f3, e7e8q\n")
                continue

            # Player's move
            moves.append(user_input)
            print(f"You play: {user_input}")

            # Engine response
            engine.set_position(moves)
            result = engine.go(depth=12)
            bestmove = result["bestmove"]

            if bestmove == "(none)" or not bestmove:
                print("Game over! No legal moves.")
                break

            moves.append(bestmove)

            # Show evaluation
            eval_str = ""
            if result["info"]:
                last_info = result["info"][-1]
                score = last_info.get("score")
                if score:
                    if score["type"] == "cp":
                        cp = score["value"] / 100
                        eval_str = f" (eval: {cp:+.2f})"
                    elif score["type"] == "mate":
                        eval_str = f" (mate in {score['value']})"

            print(f"Engine plays: {bestmove}{eval_str}")
            print(f"Moves so far: {' '.join(moves)}\n")

    print("Goodbye!")


if __name__ == "__main__":
    main()

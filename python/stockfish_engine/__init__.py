"""
stockfish_engine — UCI chess engine wrapper for Python.
"""

from .engine import UciEngine, EngineError

__version__ = "1.0.0"
__all__ = ["UciEngine", "EngineError"]

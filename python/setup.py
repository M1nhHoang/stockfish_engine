from setuptools import setup, find_packages

setup(
    name="stockfish-engine",
    version="1.0.0",
    packages=find_packages(),
    python_requires=">=3.7",
    description="Python wrapper for UCI chess engines (Stockfish, etc.)",
    license="MIT",
)

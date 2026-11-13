# Adaptive Quantile Forecaster

A deterministic, offline Node 22 forecaster for make.fun’s NVIDIA CEO Polymarket competition.

The median is the latest observed market price. The uncertainty model combines:

- a short-window, per-market realized volatility estimate with winsorized one-minute changes;
- empirical multi-minute price-change quantiles from the latest 720 minutes; and
- explicit fallbacks for short histories.

The model uses only each case’s causal history, has no network or package dependencies, and writes the exact five-quantile output schema required by the competition.

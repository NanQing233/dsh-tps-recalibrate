<p align="center">
  <img src="docs/readme-icon.svg" width="96" height="96" alt="TPS Splitter icon">
</p>

<h1 align="center">TPS Splitter</h1>

<p align="center">
  Split DeepSeek Harness's native session-wide tok/s calculation into per-model readings.
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

## Features
DeepSeek Harness's native speed meter computes token output speed for the whole session. When you switch models inside one session, the previous model's speed is blended into the current model's figure, so the reading stops being a useful per-model reference.

TPS Splitter changes the native speed pill to bucket by `provider / model`, computing `outputTokens ÷ decode time` over settled steps. It refreshes when the model changes, so a newly selected model shows no speed until it has produced output — never the previous model's reading.

## Installation


```sh
dsh plugin --profile web add dsh-tps-splitter
```


## Implementation

The Host half registers a `modelSpeed` session projection: it pins the current route at `step/start`, takes the time from the stream's first token to `assistant/message` as decode time, and aggregates `outputTokens` by the `provider/model` in `request/header`. The Client half shadows the native `activity` pill at `priority: -1`, reads `modelSpeed` and `modelSelection`, and renders the current route's reading.

## Limitations

- Only settled steps are counted; in-flight instantaneous speed is not shown.
- A model that has never produced output in this session has no speed reading.
- Turn/step counts, model/tool time, and TTFT in the stats dialog remain session-wide.

## License

[MIT License](./LICENSE)

---

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness">
    <img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" width="121" height="20" alt="powered by dsh">
  </a>
</p>

<p align="center">
  <img src="docs/readme-icon.svg" width="96" height="96" alt="计速校准图标">
</p>

<h1 align="center">计速校准</h1>

<p align="center">
  将 DeepSeek Harness 原生按会话计算 tok/s 的方式修正为按模型计算。
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

## 功能
DeepSeek Harness的原生速度计算逻辑是以会话为单位计算该会话中的 token 输出速度，因此当在同一个会话切换模型时会将先前模型的速度与当前模型的速度合并计算，导致失去单模型速度的参考价值。

本插件将原生计速胶囊逻辑改为按 `provider / model` 分桶，计算已落定步骤的 `outputTokens ÷ 解码耗时`，在切换模型时刷新，故在切换后的新模型还没有输出时不显示速度，避免沿用旧模型的读数。

## 安装


```sh
dsh plugin --profile web add dsh-tps-recalibrate
```


## 实现

Host 半注册 `modelSpeed` 会话投影：在 `step/start` 固定当前路由，以流的首个 token 到 `assistant/message` 的时间作为解码耗时，再按 `request/header` 的 `provider/model` 聚合 `outputTokens`。Client 半以 `priority: -1` 阴影原生 `activity` 胶囊，读取 `modelSpeed` 与 `modelSelection`，渲染当前路由的读数。

## 限制

- 只统计已落定的步骤，不显示生成中的瞬时速度。
- 本会话中从未产出过的模型没有速度读数。
- 统计弹窗里的轮/步、模型/工具用时和 TTFT 仍是全会话口径。

## 许可证

[MIT License](./LICENSE)

---

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness">
    <img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" width="121" height="20" alt="powered by dsh">
  </a>
</p>

# tools/

Dev 工具脚本，**不进** monorepo 任何一个 package。

## `build-bundle.cjs`

esbuild 单文件打包 `packages/server/src/index.ts` 到 `packages/server/dist/bundle.cjs`。

为什么需要这个：
- pnpm + macOS 的软链 + 文件 stat 在大项目里很慢，Node 冷启 server 需要 100+ 秒
- 用 esbuild 把 server 打包成单 CJS 文件后，**冷启 ~5 秒**

在根目录运行：

```bash
pnpm build              # 跑所有 package 的 tsc + 本脚本
# 或
pnpm bundle:server      # 只跑本脚本
```

打包脚本硬编码 `target: 'node22'`，需要改 Node 版本时直接改这里。

## `integration-test.ts`

端到端集成测试，**绕过 server bootstrap** 直接调用 core-agent + DAO + LLM 跑全链路。

为什么需要这个：
- 正常启动 server 要走 Koa 路由、middleware、sse 等，启动 + 配置 30 秒
- 当你怀疑 core-agent / DAO / LLM 调用逻辑有 bug 时，这个测试能 5 秒内给出结论

> 跟 Vitest 之类的单测不一样，这个是"组装好后整段跑"。

跑法（需要在 server 包内）：

```bash
cd packages/server
node --import tsx ../tools/integration-test.ts
# 或先 tsc 编译再跑
```

详细日志写到 `/tmp/integration.log`，可边跑边 tail。

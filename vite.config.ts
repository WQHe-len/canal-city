import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // 冷门固定端口：vite 默认从 5173 起自动递增，不会撞到 6180；
    // 也避开本机其他项目（5173/5174 为 partner-web，5180 的 localhost 被 [::1] 侧抢占）
    port: 6180,
    // 端口被占用时直接报错，不静默改用其他端口（保证访问地址稳定）
    strictPort: true,
    host: true,
    // 允许 cloudflared 隧道域名访问
    allowedHosts: ['.trycloudflare.com'],
  },
  optimizeDeps: {
    // GLTFLoader 必须与主包共用同一 three 实例：否则触发
    // "Multiple instances of Three.js" 双实例，跨实例 instanceof 判断失效
    include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'],
  },
});

# 揮棒實驗室

在自己的電腦上比對兩支揮棒影片。青色是最佳揮棒，橘色是目前這球。骨架、階段和數字都在瀏覽器裡算完，影片不會上傳。

## 可以做的事

- 指定**左打者**或**右打者**。自動判斷在比較慢的電腦上容易把左右看反；改選之後只重算階段，不用重跑骨架。
- 播放速度有 **0.1 倍慢放**，預覽和兩棒並排都會跟著走。方向鍵可以逐幀。
- 找出啟動、著地、擊球、收棒，並排出踏步、時間、手速、髖肩分離、前膝和重心。

數字是骨架估計，不是 Blast 感測器。同一支手機、同一個機位，才適合互相比。

## 本地執行

```bash
npm install
npm run dev
```

瀏覽器打開 [http://127.0.0.1:4317](http://127.0.0.1:4317)。開發和建置使用 webpack，因為姿態套件在 Turbopack 底下載入不了。`npm install` 會把 MediaPipe 的 Wasm 複製到 `public/mediapipe/wasm`。標準姿態模型約 10 MB，輕量約 6 MB，已經放在 `public/mediapipe/models`。

```bash
npm test
npm run lint
```

姿態模型為 [MediaPipe Pose Landmarker](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker)，授權 Apache-2.0。

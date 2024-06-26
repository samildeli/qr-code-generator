import { useEffect, useRef, useState } from "react";
import { proxy, useSnapshot } from "valtio";
import { EcLevel, QrCodeGenerator } from "./QrCodeGenerator";
import useMediaQuery from "./useMediaQuery";
import { range } from "./utils";

const state = proxy({ version: 0, ecLevel: EcLevel.L, data: "", error: "", isInverted: false, isMirrored: false });
let qrCodeGenerator = new QrCodeGenerator(state.version, state.ecLevel, state.data);

export default function App() {
  return (
    <div className="flex min-h-full min-w-full flex-col items-center justify-start p-4 360:py-8 1024:justify-center">
      <div className="flex flex-col items-center gap-8 1024:flex-row 1024:items-start">
        <div className="flex flex-col gap-4">
          <Message />
          <div className="flex gap-4">
            <Versions />
            <div className="flex flex-col gap-4">
              <ErrorCorrectionLevels />
              <div className="flex flex-col">
                <Invert />
                <Mirror />
              </div>
            </div>
          </div>
        </div>
        <QRCode />
      </div>
    </div>
  );
}

function Message() {
  const snap = useSnapshot(state, { sync: true });

  return (
    <div className="flex flex-col items-start">
      <div className="font-medium">Message</div>
      <textarea
        className="h-[150px] w-full resize-none border border-gray-500 p-2 focus:outline-none"
        value={snap.data}
        onChange={(event) => (state.data = event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

function Versions() {
  const snap = useSnapshot(state);

  return (
    <div className="flex flex-none flex-col">
      <div className="font-medium">Version</div>
      <div className="flex h-[250px] flex-col overflow-y-scroll border border-gray-500 p-2">
        {range(0, 41).map((version) => (
          <label key={version} className="flex select-none items-center gap-0.5">
            <input
              type="radio"
              value={version}
              checked={version === snap.version}
              onChange={() => (state.version = version)}
            />
            {version === 0 ? "Auto" : `Version ${version}`}
          </label>
        ))}
      </div>
    </div>
  );
}

function ErrorCorrectionLevels() {
  const snap = useSnapshot(state);

  return (
    <div className="flex flex-col items-start">
      <div className="font-medium">Error Correction Level</div>
      <div className="flex flex-col border border-gray-500 p-2">
        {["L (7%)", "M (15%)", "Q (25%)", "H (30%)"].map((label, ecLevel) => (
          <label key={label} className="flex select-none items-center gap-0.5">
            <input
              type="radio"
              value={label}
              checked={ecLevel === snap.ecLevel}
              onChange={() => (state.ecLevel = ecLevel)}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Invert() {
  return (
    <label className="flex select-none items-center gap-0.5">
      <input type="checkbox" onChange={(event) => (state.isInverted = event.target.checked)} />
      Invert
    </label>
  );
}

function Mirror() {
  return (
    <label className="flex select-none items-center gap-0.5">
      <input type="checkbox" onChange={(event) => (state.isMirrored = event.target.checked)} />
      Mirror
    </label>
  );
}

function QRCode() {
  const snap = useSnapshot(state);
  const preview = useRef<HTMLCanvasElement>(null);
  const [previewScale, setPreviewScale] = useState(0.75);
  const downloadBtn = useRef<HTMLAnchorElement>(null);
  const min360 = useMediaQuery("(min-width: 360px)");
  const min412 = useMediaQuery("(min-width: 412px)");

  useEffect(() => {
    setPreviewScale(0.75);
    if (min360) {
      setPreviewScale(0.85);
    }
    if (min412) {
      setPreviewScale(1);
    }
  }, [min360, min412]);

  useEffect(() => {
    try {
      qrCodeGenerator = new QrCodeGenerator(snap.version, snap.ecLevel, snap.data);
      qrCodeGenerator.generate();
      state.error = "";
    } catch (err) {
      if (err instanceof Error && err.name === "QrCodeGeneratorError") {
        state.error = err.message;
      } else {
        throw err;
      }
    }
  }, [snap.version, snap.ecLevel, snap.data]);

  useEffect(() => {
    const qrCode = qrCodeGenerator.qrCode;

    const moduleSize = Math.floor(370 / (qrCode.length + 8));
    const canvasSize = moduleSize * (qrCode.length + 8);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = canvasSize;

    const ctx = canvas.getContext("2d")!;
    const colors = !snap.isInverted ? ["white", "black"] : ["black", "white"];
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    for (let y = 0; y < qrCode.length; y++) {
      for (let x = 0; x < qrCode.length; x++) {
        const canvasX = !snap.isMirrored ? moduleSize * (4 + x) : canvasSize - moduleSize * (5 + x);
        const canvasY = moduleSize * (4 + y);
        ctx.fillStyle = colors[~~qrCode[y][x].value];
        ctx.fillRect(canvasX, canvasY, moduleSize, moduleSize);
      }
    }

    downloadBtn.current!.href = canvas.toDataURL();
    downloadBtn.current!.download = "qr-code.png";

    preview.current!.width = preview.current!.height = canvasSize * previewScale;
    preview
      .current!.getContext("2d")!
      .drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, preview.current!.width, preview.current!.height);
  }, [snap.version, snap.ecLevel, snap.data, snap.isInverted, snap.isMirrored, previewScale]);

  return (
    <div className="1024:w-[372px]">
      <div className="flex flex-col items-start">
        <div className="font-medium">QR Code</div>
        <div className={`flex flex-col items-start gap-2 ${snap.error ? "hidden" : ""}`}>
          <canvas className="border border-gray-500" ref={preview}></canvas>
          <a
            className="bg-main p-2 font-semibold leading-none text-white transition-colors duration-300 hover:bg-highlight"
            ref={downloadBtn}
          >
            Download as PNG
          </a>
        </div>
        <div className="text-[red]">{snap.error}</div>
      </div>
    </div>
  );
}

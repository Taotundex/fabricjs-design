"use client";

import dynamic from "next/dynamic";
import React from "react";

const OcrCanvasEditor = dynamic(() => import("./OcrCanvasEditor"), {
    ssr: false, // ✅ allowed here
});

export default function OcrEditorClient() {
    return <OcrCanvasEditor />;
}

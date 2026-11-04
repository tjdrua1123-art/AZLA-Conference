"use client";
import { useEffect, useRef, useState } from "react";
import { cacheRecording } from "@/lib/conference-storage";
export type CapturedPart = {
  id: string;
  file: File;
  recoveryKey: string;
  sequence: number;
};
type Options = {
  onPart: (
    meetingId: string,
    recordingId: string,
    part: CapturedPart,
  ) => Promise<void>;
  onFinish: (
    meetingId: string,
    recordingId: string,
    seconds: number,
    failed: boolean,
  ) => Promise<void>;
  onError: (message: string) => void;
  onStarted: (meetingId: string, recordingId: string) => Promise<void>;
};
// This hook lives above the tab content. Tab switches never dispose the microphone.
export function useMeetingRecorder(options: Options) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<{
    meetingId: string;
    recordingId: string;
    started: number;
    ending: boolean;
    failed: boolean;
    index: number;
    finishing: boolean;
    endedAt: number | null;
    mime: string;
    queue: Promise<void>;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<
    "idle" | "starting" | "recording" | "saving"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [activeMeeting, setActiveMeeting] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      const c = context.current;
      if (c) c.ending = true;
      if (media.current?.state === "recording") media.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const clock = setInterval(() => {
      if (context.current)
        setSeconds(Math.floor((Date.now() - context.current.started) / 1000));
    }, 1000);
    return () => clearInterval(clock);
  }, [phase]);
  function segment() {
    const c = context.current;
    if (!c || c.ending || !stream.current?.active) return;
    const chunks: Blob[] = [];
    let size = 0;
    const recorder = new MediaRecorder(stream.current, {
      mimeType: c.mime,
      audioBitsPerSecond: 64000,
    });
    media.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) {
        chunks.push(e.data);
        size += e.data.size;
      }
      if (size > 16 * 1024 * 1024 && recorder.state === "recording")
        recorder.stop();
    };
    recorder.onerror = () => {
      c.failed = true;
      c.ending = true;
      c.endedAt = Date.now();
      callbacks.current.onError(
        "마이크 녹음 오류가 발생했습니다. 저장된 구간을 확인해 주세요.",
      );
      if (recorder.state === "recording") recorder.stop();
      else void complete();
    };
    recorder.onstop = () => {
      if (timer.current) clearTimeout(timer.current);
      const id = crypto.randomUUID();
      const index = ++c.index;
      const file = new File(
        chunks,
        `회의녹음-${index}.${c.mime.includes("mp4") ? "mp4" : c.mime.includes("ogg") ? "ogg" : "webm"}`,
        { type: c.mime },
      );
      if (file.size) {
        const recoveryKey = `${c.recordingId}/${String(index).padStart(4, "0")}-${id}`;
        c.queue = c.queue
          .then(async () => {
            await cacheRecording(recoveryKey, file);
            if (mounted.current)
              await callbacks.current.onPart(c.meetingId, c.recordingId, {
                id,
                file,
                recoveryKey,
                sequence: index,
              });
          })
          .catch((e) => {
            c.failed = true;
            callbacks.current.onError(
              e instanceof Error ? e.message : "녹음 구간 저장에 실패했습니다.",
            );
            const url = URL.createObjectURL(file);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          });
      }
      if (!c.ending && mounted.current) segment();
      else void complete();
    };
    recorder.start(2000);
    timer.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 240000);
  }
  async function complete() {
    const c = context.current;
    if (!c || c.finishing) return;
    c.finishing = true;
    stream.current?.getTracks().forEach((t) => t.stop());
    if (mounted.current) setPhase("saving");
    await c.queue;
    try {
      if (mounted.current)
        await callbacks.current.onFinish(
          c.meetingId,
          c.recordingId,
          Math.floor(((c.endedAt ?? Date.now()) - c.started) / 1000),
          c.failed,
        );
    } catch (e) {
      callbacks.current.onError(
        e instanceof Error ? e.message : "회의 종료 처리에 실패했습니다.",
      );
    } finally {
      if (mounted.current) {
        setPhase("idle");
        setActiveMeeting("");
      }
      context.current = null;
    }
  }
  async function start(meetingId: string, recordingId: string) {
    if (context.current || phase !== "idle") return;
    setPhase("starting");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "마이크를 사용할 수 있는 HTTPS 브라우저에서 열어 주세요.",
        );
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((v) =>
        MediaRecorder.isTypeSupported(v),
      );
      if (!mime)
        throw new Error("이 브라우저에서 녹음 형식을 지원하지 않습니다.");
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      await callbacks.current.onStarted(meetingId, recordingId);
      context.current = {
        meetingId,
        recordingId,
        started: Date.now(),
        ending: false,
        failed: false,
        index: 0,
        finishing: false,
        endedAt: null,
        mime,
        queue: Promise.resolve(),
      };
      setActiveMeeting(meetingId);
      setSeconds(0);
      stream.current.getAudioTracks().forEach((track) => {
        track.onended = () => {
          const c = context.current;
          if (!c || c.ending) return;
          c.ending = true;
          c.failed = true;
          c.endedAt = Date.now();
          callbacks.current.onError(
            "마이크 연결이 종료됐습니다. 저장된 녹음을 확인해 주세요.",
          );
          if (media.current?.state === "recording") media.current.stop();
          else void complete();
        };
      });
      segment();
      setPhase("recording");
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      context.current = null;
      setPhase("idle");
      callbacks.current.onError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "브라우저에서 마이크 권한을 허용한 뒤 다시 시작해 주세요."
          : e instanceof Error
            ? e.message
            : "마이크 접근을 허용해 주세요.",
      );
    }
  }
  function stop() {
    const c = context.current;
    if (!c || c.ending) return;
    c.ending = true;
    c.endedAt = Date.now();
    setPhase("saving");
    if (timer.current) clearTimeout(timer.current);
    if (media.current?.state === "recording") media.current.stop();
    else void complete();
  }
  return { phase, seconds, activeMeeting, start, stop };
}

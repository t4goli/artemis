import { CameraView, useCameraPermissions } from "expo-camera";
import { DeviceMotion, type DeviceMotionMeasurement } from "expo-sensors";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

type Target = {
  id: number;
  yaw: number;
  pitch: "level" | "up" | "down";
  captured: boolean;
};

const initialTargets: Target[] = Array.from({ length: 16 }, (_, index) => ({
  id: index,
  yaw: 0,
  pitch: "level",
  captured: false,
}));

const expansionTargets = [
  { x: 0, y: 0 },
  { x: 124, y: 0 },
  { x: -124, y: 0 },
  { x: 0, y: -132 },
  { x: 0, y: 132 },
  { x: 124, y: -96 },
  { x: -124, y: -96 },
  { x: 124, y: 96 },
  { x: -124, y: 96 },
  { x: 170, y: 0 },
  { x: -170, y: 0 },
  { x: 0, y: -174 },
  { x: 0, y: 174 },
  { x: 170, y: -124 },
  { x: -170, y: -124 },
  { x: 0, y: 0 },
];

export default function App() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [captureName, setCaptureName] = useState("My memory");
  const [isCapturing, setIsCapturing] = useState(false);
  const [targets, setTargets] = useState(initialTargets);
  const [activeTargetIndex, setActiveTargetIndex] = useState(0);
  const [manualHold, setManualHold] = useState(false);
  const [deviceRotation, setDeviceRotation] = useState({ yaw: 0, pitch: 0 });
  const [originYaw, setOriginYaw] = useState<number | null>(null);

  const activeTarget = targets[activeTargetIndex];
  const capturedCount = targets.filter((target) => target.captured).length;
  const visibleTargets = useMemo(() => {
    return targets
      .filter((target) => !target.captured)
      .map((target) => ({ target, projection: projectTarget(target, deviceRotation, capturedCount) }))
      .filter(({ projection }) => projection.visible)
      .slice(0, 5);
  }, [activeTarget, capturedCount, deviceRotation, targets]);
  const activeProjection = useMemo(
    () => projectTarget(activeTarget, deviceRotation, capturedCount),
    [activeTarget, capturedCount, deviceRotation]
  );
  const alignmentDistance = Math.hypot(activeProjection.x, activeProjection.y);
  const isAligned = activeProjection.visible && (capturedCount === 0 || alignmentDistance < 92);
  const guidance = useMemo(() => {
    if (!activeTarget) return "All targets captured. Ready to upload.";
    if (activeTarget.pitch === "up") return "Tilt up and line up with the red dot.";
    if (activeTarget.pitch === "down") return "Tilt down and line up with the red dot.";
    return "Turn slowly until the circle meets the red dot.";
  }, [activeTarget]);

  async function beginCapture() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) return;
    }

    await DeviceMotion.requestPermissionsAsync();
    DeviceMotion.setUpdateInterval(50);
    setTargets(initialTargets);
    setActiveTargetIndex(0);
    setManualHold(false);
    setOriginYaw(null);
    setIsCapturing(true);
  }

  useEffect(() => {
    if (!isCapturing) return;

    const subscription = DeviceMotion.addListener((motion) => {
      const nextRotation = getRotation(motion);
      setOriginYaw((currentOrigin) => currentOrigin ?? nextRotation.yaw);
      setDeviceRotation((currentRotation) => {
        const yawOrigin = originYaw ?? nextRotation.yaw;
        return {
          yaw: normalizeDegrees(nextRotation.yaw - yawOrigin),
          pitch: nextRotation.pitch,
        };
      });
    });

    return () => subscription.remove();
  }, [isCapturing, originYaw]);

  function simulateAlignment() {
    if (!activeTarget) return;
    if (!manualHold && !isAligned) {
      setManualHold(true);
      return;
    }

    setTargets((currentTargets) =>
      currentTargets.map((target) => (target.id === activeTarget.id ? { ...target, captured: true } : target))
    );
    setActiveTargetIndex((index) => Math.min(index + 1, targets.length));
    setManualHold(false);
  }

  if (!isCapturing) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.captureTab}>
          <Text style={styles.eyebrow}>Capture</Text>
          <Text style={styles.title}>Artemis</Text>
          <Text style={styles.subtitle}>Name a memory, then follow the dots to capture a full 360.</Text>

          <View style={styles.formCard}>
            <Text style={styles.label}>Capture name</Text>
            <TextInput
              value={captureName}
              onChangeText={setCaptureName}
              placeholder="Kitchen sunset"
              placeholderTextColor="#687789"
              style={styles.input}
            />
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Capture plan</Text>
            <Text style={styles.summaryText}>16 guided targets using the phone camera, motion tracking, and locked exposure.</Text>
            <View style={styles.planRow}>
              <Text style={styles.planValue}>10</Text>
              <Text style={styles.planLabel}>level</Text>
              <Text style={styles.planValue}>3</Text>
              <Text style={styles.planLabel}>ceiling</Text>
              <Text style={styles.planValue}>3</Text>
              <Text style={styles.planLabel}>floor</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.primaryButton} activeOpacity={0.88} onPress={beginCapture}>
            <Text style={styles.primaryButtonText}>Begin capture</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.captureScreen}>
      <StatusBar style="light" />
      <View style={styles.captureStage}>
        <View style={styles.captureTopBar}>
          <TouchableOpacity onPress={() => setIsCapturing(false)} style={styles.roundButton}>
            <Text style={styles.roundButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.topCenterDot} />
          <TouchableOpacity onPress={() => setIsCapturing(false)} style={[styles.roundButton, styles.exitButton]}>
            <Text style={styles.exitButtonText}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tiltPrompt}>
          <View style={styles.tiltIcon}>
            <Text style={styles.tiltIconText}>▰</Text>
          </View>
          <Text style={styles.tiltText}>{tiltPrompt(activeProjection.y)}</Text>
        </View>

        <View style={styles.worldViewport}>
          {capturedCount > 0 && (
            <View
              style={[
                styles.capturedPlane,
                {
                  transform: [
                    { perspective: 900 },
                    { rotateZ: `${clamp(shortestAngle(deviceRotation.yaw) * -0.06, -12, 12)}deg` },
                    { rotateY: `${clamp(shortestAngle(deviceRotation.yaw) * -0.12, -18, 18)}deg` },
                  ],
                },
              ]}
            >
              {cameraPermission?.granted ? (
                <CameraView
                  style={styles.liveCamera}
                  facing="back"
                  mode="picture"
                  autofocus="on"
                  selectedLens="builtInWideAngleCamera"
                  responsiveOrientationWhenOrientationLocked
                />
              ) : (
                <View style={styles.blackPreview}>
                  <Text style={styles.previewText}>Camera permission needed</Text>
                </View>
              )}
            </View>
          )}

          {capturedCount === 0 && (
            <View style={styles.firstCaptureFrame}>
              {cameraPermission?.granted ? (
                <CameraView
                  style={styles.liveCamera}
                  facing="back"
                  mode="picture"
                  autofocus="on"
                  selectedLens="builtInWideAngleCamera"
                  responsiveOrientationWhenOrientationLocked
                />
              ) : (
                <View style={styles.blackPreview}>
                  <Text style={styles.previewText}>Camera permission needed</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.aimLayer}>
            {visibleTargets.map(({ target, projection }) => (
              <View
                key={target.id}
                style={[
                  styles.targetDot,
                  target.id === activeTarget?.id && styles.activeTargetDot,
                  target.id === activeTarget?.id && alignmentDistance < 138 && styles.nearTargetDot,
                  target.id === activeTarget?.id && isAligned && styles.alignedTargetDot,
                  { transform: [{ translateX: projection.x }, { translateY: projection.y }] },
                ]}
              />
            ))}
            {!activeProjection.visible && <Text style={styles.directionChevron}>{activeProjection.angleX > 0 ? "›" : "‹"}</Text>}
            <View style={[styles.deviceCircle, isAligned && styles.deviceCircleAligned]}>
              {isAligned && <View style={styles.holdWedge} />}
            </View>
          </View>
        </View>

        <Text style={styles.bottomInstruction}>
          {capturedCount === 0
            ? "Point your device at the green target"
            : "Shoot all photos from the same spot as your initial photo to ensure an optimal result."}
        </Text>

        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(4, (capturedCount / targets.length) * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {capturedCount} of {targets.length}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.primaryButton} activeOpacity={0.88} onPress={simulateAlignment}>
        <Text style={styles.primaryButtonText}>{isAligned || manualHold ? "Simulate capture" : "Skip to capture"}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function getRotation(motion: DeviceMotionMeasurement) {
  return {
    yaw: normalizeDegrees(toDegrees(motion.rotation.alpha)),
    pitch: clamp(toDegrees(motion.rotation.beta), -75, 75),
  };
}

function projectTarget(target: Target | undefined, rotation: { yaw: number; pitch: number }, capturedCount: number) {
  if (!target) return { x: 0, y: 0, angleX: 0, angleY: 0, visible: false };
  if (capturedCount === 0) {
    return { x: 0, y: 0, angleX: 0, angleY: 0, visible: true };
  }

  const expansion = expansionTargets[target.id] ?? { x: 0, y: 0 };
  const wobbleX = Math.sin((rotation.yaw * Math.PI) / 180) * 24;
  const wobbleY = Math.sin((rotation.pitch * Math.PI) / 90) * 22;
  return {
    x: expansion.x - wobbleX,
    y: expansion.y + wobbleY,
    angleX: (expansion.x - wobbleX) / 12,
    angleY: (expansion.y + wobbleY) / 12,
    visible: true,
  };
}

function toDegrees(value: number) {
  return Math.abs(value) <= Math.PI * 2 ? (value * 180) / Math.PI : value;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function shortestAngle(value: number) {
  const normalized = ((value + 180) % 360) - 180;
  return normalized < -180 ? normalized + 360 : normalized;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function tiltPrompt(offsetY: number) {
  if (offsetY < -50) return "Tilt your device up";
  if (offsetY > 50) return "Tilt your device down";
  return "Point your device at the target";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0b0f14",
  },
  captureTab: {
    flex: 1,
    padding: 22,
    gap: 18,
    justifyContent: "center",
  },
  eyebrow: {
    color: "#89b6ff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: "#f7fbff",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 0,
  },
  subtitle: {
    color: "#aab6c4",
    fontSize: 16,
    lineHeight: 23,
  },
  formCard: {
    gap: 8,
  },
  label: {
    color: "#c8d3df",
    fontSize: 14,
    fontWeight: "800",
  },
  input: {
    minHeight: 54,
    borderRadius: 8,
    paddingHorizontal: 14,
    color: "#f7fbff",
    backgroundColor: "#121a23",
    borderWidth: 1,
    borderColor: "#263443",
    fontSize: 17,
    fontWeight: "700",
  },
  summaryCard: {
    padding: 16,
    borderRadius: 8,
    gap: 10,
    backgroundColor: "#121a23",
    borderWidth: 1,
    borderColor: "#263443",
  },
  summaryTitle: {
    color: "#f7fbff",
    fontSize: 18,
    fontWeight: "900",
  },
  summaryText: {
    color: "#9eabb9",
    fontSize: 14,
    lineHeight: 20,
  },
  planRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  planValue: {
    color: "#f3c04d",
    fontSize: 24,
    fontWeight: "900",
  },
  planLabel: {
    color: "#aab6c4",
    fontSize: 13,
    fontWeight: "800",
    marginRight: 6,
  },
  primaryButton: {
    minHeight: 56,
    marginHorizontal: 18,
    marginBottom: 18,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3c04d",
  },
  primaryButtonText: {
    color: "#141007",
    fontSize: 16,
    fontWeight: "900",
  },
  captureScreen: {
    flex: 1,
    backgroundColor: "#05070a",
  },
  captureStage: {
    flex: 1,
    backgroundColor: "#000000",
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 10,
  },
  liveCamera: {
    ...StyleSheet.absoluteFillObject,
  },
  blackPreview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  },
  previewText: {
    color: "#e9eef5",
    fontSize: 22,
    fontWeight: "900",
  },
  previewSubtext: {
    color: "#6f7b89",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 36,
  },
  aimLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  targetDot: {
    position: "absolute",
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "rgba(28, 220, 70, 0.72)",
  },
  activeTargetDot: {
    backgroundColor: "rgba(255, 64, 72, 0.92)",
  },
  nearTargetDot: {
    backgroundColor: "rgba(245, 210, 58, 0.86)",
  },
  alignedTargetDot: {
    backgroundColor: "rgba(28, 235, 75, 0.92)",
  },
  deviceCircle: {
    position: "absolute",
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceCircleAligned: {
    borderColor: "#ffffff",
  },
  holdWedge: {
    width: 46,
    height: 46,
    borderTopLeftRadius: 46,
    backgroundColor: "rgba(28, 235, 75, 0.78)",
  },
  captureTopBar: {
    minHeight: 58,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  roundButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  roundButtonText: {
    color: "#05070a",
    fontSize: 44,
    fontWeight: "900",
    lineHeight: 48,
  },
  topCenterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2dea5a",
  },
  exitButton: {
    backgroundColor: "#ff252d",
  },
  exitButtonText: {
    color: "#030303",
    fontSize: 44,
    fontWeight: "900",
    lineHeight: 48,
  },
  tiltPrompt: {
    minHeight: 108,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  tiltIcon: {
    width: 74,
    height: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  tiltIconText: {
    color: "#ffffff",
    fontSize: 36,
    transform: [{ rotate: "-45deg" }],
  },
  tiltText: {
    color: "#ffffff",
    fontSize: 22,
    textAlign: "center",
  },
  worldViewport: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  firstCaptureFrame: {
    width: "82%",
    aspectRatio: 0.76,
    borderWidth: 1,
    borderColor: "#ffffff",
    overflow: "hidden",
    backgroundColor: "#0a0a0a",
  },
  capturedPlane: {
    width: "92%",
    aspectRatio: 0.76,
    borderWidth: 1,
    borderColor: "#ffffff",
    overflow: "hidden",
    backgroundColor: "#0a0a0a",
  },
  directionChevron: {
    position: "absolute",
    color: "#ffffff",
    fontSize: 60,
    fontWeight: "300",
    transform: [{ translateX: 72 }],
  },
  bottomInstruction: {
    minHeight: 82,
    color: "#ffffff",
    fontSize: 22,
    lineHeight: 30,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  progressRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 20,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#28dd5d",
  },
  progressText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
});

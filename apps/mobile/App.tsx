import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

type Target = {
  id: number;
  yaw: number;
  pitch: "level" | "up" | "down";
  captured: boolean;
};

const initialTargets: Target[] = Array.from({ length: 16 }, (_, index) => ({
  id: index,
  yaw: Math.round(index * 22.5),
  pitch: index < 10 ? "level" : index < 13 ? "up" : "down",
  captured: false,
}));

export default function App() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [captureName, setCaptureName] = useState("My memory");
  const [isCapturing, setIsCapturing] = useState(false);
  const [targets, setTargets] = useState(initialTargets);
  const [activeTargetIndex, setActiveTargetIndex] = useState(0);
  const [isAligned, setIsAligned] = useState(false);

  const activeTarget = targets[activeTargetIndex];
  const capturedCount = targets.filter((target) => target.captured).length;
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

    setTargets(initialTargets);
    setActiveTargetIndex(0);
    setIsAligned(false);
    setIsCapturing(true);
  }

  function simulateAlignment() {
    if (!activeTarget) return;
    if (!isAligned) {
      setIsAligned(true);
      return;
    }

    setTargets((currentTargets) =>
      currentTargets.map((target) => (target.id === activeTarget.id ? { ...target, captured: true } : target))
    );
    setActiveTargetIndex((index) => Math.min(index + 1, targets.length));
    setIsAligned(false);
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
      <View style={styles.cameraPreview}>
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
            <Text style={styles.previewSubtext}>Exit and tap Begin capture to allow camera access.</Text>
          </View>
        )}

        <View style={styles.aimLayer}>
          <View style={[styles.targetCircle, isAligned && styles.targetCircleAligned]}>
            <View style={[styles.innerTarget, isAligned && styles.innerTargetAligned]} />
          </View>
          <View style={styles.deviceCircle} />
        </View>

        <View style={styles.captureTopBar}>
          <View>
            <Text style={styles.topLabel}>{captureName}</Text>
            <Text style={styles.topValue}>
              {capturedCount}/{targets.length} captured
            </Text>
          </View>
          <TouchableOpacity onPress={() => setIsCapturing(false)} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Exit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.guidanceCard}>
          <Text style={styles.guidanceTitle}>{isAligned ? "Hold steady" : guidance}</Text>
          <Text style={styles.guidanceText}>
            {isAligned ? "Capturing once the target stays green." : `Target ${activeTargetIndex + 1}: ${activeTarget?.yaw ?? 0} degrees`}
          </Text>
        </View>
      </View>

      <View style={styles.targetMap}>
        {targets.map((target, index) => (
          <View
            key={target.id}
            style={[
              styles.mapDot,
              target.captured && styles.mapDotCaptured,
              index === activeTargetIndex && styles.mapDotActive,
            ]}
          />
        ))}
      </View>

      <TouchableOpacity style={styles.primaryButton} activeOpacity={0.88} onPress={simulateAlignment}>
        <Text style={styles.primaryButtonText}>{isAligned ? "Simulate capture" : "Simulate align"}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
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
  cameraPreview: {
    flex: 1,
    margin: 10,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#000000",
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
  targetCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 4,
    borderColor: "#ff4d4d",
    alignItems: "center",
    justifyContent: "center",
  },
  targetCircleAligned: {
    borderColor: "#45e07a",
  },
  innerTarget: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#ff4d4d",
  },
  innerTargetAligned: {
    backgroundColor: "#45e07a",
  },
  deviceCircle: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  captureTopBar: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topLabel: {
    color: "#cbd7e5",
    fontSize: 13,
    fontWeight: "800",
  },
  topValue: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
  smallButton: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  smallButtonText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  guidanceCard: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    padding: 16,
    borderRadius: 8,
    backgroundColor: "rgba(7, 10, 14, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  guidanceTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
  },
  guidanceText: {
    color: "#aeb8c5",
    fontSize: 14,
    marginTop: 4,
  },
  targetMap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  mapDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#17202b",
    borderWidth: 1,
    borderColor: "#59697a",
  },
  mapDotActive: {
    borderColor: "#ff4d4d",
    borderWidth: 3,
  },
  mapDotCaptured: {
    backgroundColor: "#45e07a",
    borderColor: "#45e07a",
  },
});

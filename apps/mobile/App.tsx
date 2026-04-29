import { StatusBar } from "expo-status-bar";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type ScanPhase = {
  id: string;
  label: string;
  detail: string;
  captured: number;
  total: number;
};

const phases: ScanPhase[] = [
  {
    id: "level",
    label: "Level sweep",
    detail: "Rotate from one spot with the phone held upright.",
    captured: 0,
    total: 16,
  },
  {
    id: "ceiling",
    label: "Ceiling sweep",
    detail: "Tilt up and connect the upper walls into the ceiling.",
    captured: 0,
    total: 8,
  },
  {
    id: "floor",
    label: "Floor sweep",
    detail: "Tilt down and connect the lower walls into the floor.",
    captured: 0,
    total: 8,
  },
];

const nextTargets = ["0", "22", "45", "67", "90", "112", "135", "157", "180", "202", "225", "247", "270", "292", "315", "337"];

export default function App() {
  const totalCaptured = phases.reduce((sum, phase) => sum + phase.captured, 0);
  const totalTargets = phases.reduce((sum, phase) => sum + phase.total, 0);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Private capture</Text>
          <Text style={styles.title}>Artemis</Text>
          <Text style={styles.subtitle}>Guided phone capture for full 360 memories.</Text>
        </View>

        <View style={styles.cameraPanel}>
          <View style={styles.reticle}>
            <Text style={styles.reticleText}>Camera preview</Text>
            <Text style={styles.reticleSubtext}>AR pose + wide camera integration comes next</Text>
          </View>
          <View style={styles.captureHud}>
            <Text style={styles.hudLabel}>Coverage</Text>
            <Text style={styles.hudValue}>
              {totalCaptured}/{totalTargets}
            </Text>
          </View>
        </View>

        <View style={styles.targetBand}>
          {nextTargets.map((target, index) => (
            <View key={target} style={[styles.targetDot, index === 0 && styles.targetDotActive]}>
              <Text style={[styles.targetText, index === 0 && styles.targetTextActive]}>{target}</Text>
            </View>
          ))}
        </View>

        <View style={styles.phaseList}>
          {phases.map((phase, index) => (
            <View key={phase.id} style={styles.phaseRow}>
              <View style={[styles.phaseIndex, index === 0 && styles.phaseIndexActive]}>
                <Text style={[styles.phaseIndexText, index === 0 && styles.phaseIndexTextActive]}>{index + 1}</Text>
              </View>
              <View style={styles.phaseCopy}>
                <Text style={styles.phaseLabel}>{phase.label}</Text>
                <Text style={styles.phaseDetail}>{phase.detail}</Text>
              </View>
              <Text style={styles.phaseCount}>
                {phase.captured}/{phase.total}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.pipeline}>
          <Text style={styles.pipelineTitle}>Serious pipeline</Text>
          <Text style={styles.pipelineText}>Capture frames with pose metadata, reject blur, upload privately, stitch on the backend, publish a public 360 viewer link.</Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>Start private scan</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0b0f14",
  },
  content: {
    padding: 20,
    gap: 18,
  },
  header: {
    gap: 4,
  },
  eyebrow: {
    color: "#8db8ff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: "#f7fbff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 0,
  },
  subtitle: {
    color: "#aeb8c5",
    fontSize: 16,
    lineHeight: 22,
  },
  cameraPanel: {
    minHeight: 360,
    borderRadius: 8,
    backgroundColor: "#131a22",
    borderWidth: 1,
    borderColor: "#263241",
    overflow: "hidden",
  },
  reticle: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    borderWidth: 1,
    borderColor: "#3f8cff",
    margin: 18,
  },
  reticleText: {
    color: "#f7fbff",
    fontSize: 22,
    fontWeight: "800",
  },
  reticleSubtext: {
    marginTop: 8,
    color: "#8d99a8",
    fontSize: 14,
    textAlign: "center",
  },
  captureHud: {
    position: "absolute",
    right: 16,
    top: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    alignItems: "flex-end",
  },
  hudLabel: {
    color: "#98a6b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  hudValue: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
  },
  targetBand: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  targetDot: {
    minWidth: 44,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17202b",
    borderWidth: 1,
    borderColor: "#2b3747",
  },
  targetDotActive: {
    backgroundColor: "#f3c04d",
    borderColor: "#f8d176",
  },
  targetText: {
    color: "#9eabb9",
    fontSize: 12,
    fontWeight: "700",
  },
  targetTextActive: {
    color: "#15120a",
  },
  phaseList: {
    gap: 10,
  },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#111820",
    borderWidth: 1,
    borderColor: "#223040",
  },
  phaseIndex: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#223040",
  },
  phaseIndexActive: {
    backgroundColor: "#8db8ff",
  },
  phaseIndexText: {
    color: "#d7e2ef",
    fontWeight: "800",
  },
  phaseIndexTextActive: {
    color: "#06111f",
  },
  phaseCopy: {
    flex: 1,
    gap: 3,
  },
  phaseLabel: {
    color: "#f6f8fb",
    fontSize: 16,
    fontWeight: "800",
  },
  phaseDetail: {
    color: "#93a0af",
    fontSize: 13,
    lineHeight: 18,
  },
  phaseCount: {
    color: "#c7d3e1",
    fontSize: 14,
    fontWeight: "800",
  },
  pipeline: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#16202a",
    borderWidth: 1,
    borderColor: "#2c3b4c",
    gap: 6,
  },
  pipelineTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
  },
  pipelineText: {
    color: "#a8b5c4",
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: 54,
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
});

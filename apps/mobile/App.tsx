import { CameraView, useCameraPermissions } from "expo-camera";
import { DeviceMotion, type DeviceMotionMeasurement } from "expo-sensors";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const GREEN = "#3cb450";
const RED = "#e03030";
const BUTTON = "#e0e0e0";
const TEXT_MUTED = "#888888";
const DOT_SIZE = 50;
const RETICLE_SIZE = 64;
const LOCK_RADIUS = 42;
const FIRST_LOCK_RADIUS = 38;
const HOLD_MS = 1000;
const FIRST_HOLD_MS = 2400;
const MOTION_INTERVAL_MS = 40;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CENTER = { x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 };
const FIRST_DOT_SIZE = Math.min(SCREEN_WIDTH * 0.92, 370);
const FIRST_DOT_NORMAL_DISTANCE = 72;
const FIRST_DOT_FAR_DISTANCE = 260;
const FIRST_DOT_MAX_SIDE_DRIFT = 18;

type CaptureTarget = {
  id: number;
  x: number;
  y: number;
};

type MotionOrigin = {
  yaw: number;
  pitch: number;
  roll: number;
};

const TARGETS: CaptureTarget[] = [
  { id: 0, x: 0, y: 0 },
  { id: 1, x: 165, y: 0 },
  { id: 2, x: -165, y: 0 },
  { id: 3, x: 0, y: -170 },
  { id: 4, x: 0, y: 170 },
  { id: 5, x: 165, y: -135 },
  { id: 6, x: -165, y: -135 },
  { id: 7, x: 165, y: 135 },
  { id: 8, x: -165, y: 135 },
  { id: 9, x: 280, y: -24 },
  { id: 10, x: -280, y: 24 },
  { id: 11, x: 34, y: -286 },
  { id: 12, x: -34, y: 286 },
  { id: 13, x: 285, y: -235 },
  { id: 14, x: -285, y: -235 },
  { id: 15, x: 285, y: 235 },
];

function radiansToDegrees(value = 0) {
  return (value * 180) / Math.PI;
}

function shortestAngle(current: number, origin: number) {
  let delta = current - origin;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function motionToPose(motion: DeviceMotionMeasurement): MotionOrigin | null {
  const rotation = motion.rotation;
  if (!rotation) return null;

  return {
    yaw: radiansToDegrees(rotation.alpha),
    pitch: radiansToDegrees(rotation.beta),
    roll: radiansToDegrees(rotation.gamma),
  };
}

function targetScreenPosition(target: CaptureTarget, pan: { x: number; y: number }) {
  return {
    x: CENTER.x + target.x + pan.x,
    y: CENTER.y + target.y + pan.y,
  };
}

function targetOffsetFromCenter(target: CaptureTarget, pan: { x: number; y: number }) {
  const position = targetScreenPosition(target, pan);
  return {
    x: position.x - CENTER.x,
    y: position.y - CENTER.y,
  };
}

function directionText(offset: { x: number; y: number }) {
  if (Math.abs(offset.x) > Math.abs(offset.y)) {
    return offset.x > 0 ? "Tilt your device to the right" : "Tilt your device to the left";
  }

  return offset.y > 0 ? "Tilt your device down" : "Tilt your device up";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function firstDotSize(distance: number) {
  const t = clamp(
    (distance - FIRST_DOT_NORMAL_DISTANCE) / (FIRST_DOT_FAR_DISTANCE - FIRST_DOT_NORMAL_DISTANCE),
    0,
    1,
  );

  return DOT_SIZE + (FIRST_DOT_SIZE - DOT_SIZE) * t;
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [captureName, setCaptureName] = useState("Tokyo Tower 🚀");
  const [isCapturing, setIsCapturing] = useState(false);
  const [queuedName, setQueuedName] = useState("");
  const [capturedIds, setCapturedIds] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [holdProgress, setHoldProgress] = useState(0);
  const [showNudge, setShowNudge] = useState(false);
  const [motionWarning, setMotionWarning] = useState(false);

  const originRef = useRef<MotionOrigin | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const activeIndexRef = useRef(0);
  const capturedIdsRef = useRef<number[]>([]);
  const pulse = useRef(new Animated.Value(0)).current;

  const activeTarget = TARGETS[activeIndex] ?? TARGETS[TARGETS.length - 1];
  const capturedCount = capturedIds.length;
  const isFirstTarget = capturedCount === 0 && activeIndex === 0;
  const firstTargetTravel = FIRST_DOT_FAR_DISTANCE - clamp(Math.abs(pan.y), 0, FIRST_DOT_FAR_DISTANCE);
  const firstTargetOffset = {
    x: clamp(pan.x * 0.03, -FIRST_DOT_MAX_SIDE_DRIFT, FIRST_DOT_MAX_SIDE_DRIFT),
    y: -FIRST_DOT_FAR_DISTANCE + firstTargetTravel,
  };
  const activeOffset = isFirstTarget ? firstTargetOffset : targetOffsetFromCenter(activeTarget, pan);
  const firstTargetVerticalDistance = Math.abs(activeOffset.y);
  const activeDistance = isFirstTarget ? firstTargetVerticalDistance : Math.hypot(activeOffset.x, activeOffset.y);
  const activeLockRadius = isFirstTarget ? FIRST_LOCK_RADIUS : LOCK_RADIUS;
  const isLocked = activeDistance <= activeLockRadius;
  const progress = capturedCount / TARGETS.length;
  const visibleTargets = capturedCount === 0 ? [activeTarget] : TARGETS;

  const pulseStyle = useMemo(
    () => ({
      opacity: pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.7, 1],
      }),
      transform: [
        {
          scale: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 1.18],
          }),
        },
      ],
    }),
    [pulse],
  );

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 650,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    capturedIdsRef.current = capturedIds;
  }, [capturedIds]);

  useEffect(() => {
    if (!isCapturing) return;

    DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
    const subscription = DeviceMotion.addListener((motion) => {
      const pose = motionToPose(motion);
      if (!pose) return;

      if (!originRef.current) {
        originRef.current = pose;
      }

      const currentOrigin = originRef.current;
      const yawDelta = shortestAngle(pose.yaw, currentOrigin.yaw);
      const pitchDelta = pose.pitch - currentOrigin.pitch;
      const rollDelta = pose.roll - currentOrigin.roll;

      setPan({
        x: -yawDelta * 6.4,
        y: pitchDelta * 6.1,
      });

      setMotionWarning(Math.abs(rollDelta) > 42);
    });

    return () => subscription.remove();
  }, [isCapturing]);

  useEffect(() => {
    if (!isCapturing) return;

    if (isLocked) {
      setShowNudge(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowNudge(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [activeIndex, activeDistance, isCapturing, isLocked]);

  useEffect(() => {
    if (!isCapturing) return;

    if (!isLocked) {
      holdStartRef.current = null;
      setHoldProgress(0);
      return;
    }

    if (!holdStartRef.current) {
      holdStartRef.current = Date.now();
    }

    const timer = setInterval(() => {
      const start = holdStartRef.current ?? Date.now();
      const holdDuration = isFirstTarget ? FIRST_HOLD_MS : HOLD_MS;
      const nextProgress = Math.min(1, (Date.now() - start) / holdDuration);
      setHoldProgress(nextProgress);

      if (nextProgress >= 1) {
        holdStartRef.current = null;
        completeCurrentTarget();
      }
    }, 40);

    return () => clearInterval(timer);
  }, [isCapturing, isLocked, activeIndex, isFirstTarget]);

  async function beginCapture() {
    if (!permission?.granted) {
      const nextPermission = await requestPermission();
      if (!nextPermission.granted) return;
    }

    await DeviceMotion.requestPermissionsAsync();
    originRef.current = null;
    setPan({ x: 0, y: 0 });
    setCapturedIds([]);
    setActiveIndex(0);
    setHoldProgress(0);
    setShowNudge(false);
    setMotionWarning(false);
    setIsCapturing(true);
  }

  function leaveCapture() {
    setIsCapturing(false);
    setHoldProgress(0);
    setShowNudge(false);
  }

  function completeCurrentTarget() {
    const currentIndex = activeIndexRef.current;
    const currentTarget = TARGETS[currentIndex];
    const currentCaptured = capturedIdsRef.current;

    if (!currentTarget || currentCaptured.includes(currentTarget.id)) return;

    const nextCaptured = [...currentCaptured, currentTarget.id];
    capturedIdsRef.current = nextCaptured;
    setCapturedIds(nextCaptured);
    setHoldProgress(0);

    if (nextCaptured.length >= TARGETS.length) {
      setQueuedName(captureName.trim() || "Untitled capture");
      setIsCapturing(false);
      return;
    }

    const nextIndex = TARGETS.findIndex((target) => !nextCaptured.includes(target.id));
    activeIndexRef.current = nextIndex === -1 ? currentIndex : nextIndex;
    setActiveIndex(nextIndex === -1 ? currentIndex : nextIndex);
  }

  if (isCapturing) {
    return (
      <View style={styles.captureScreen}>
        <CameraView style={styles.cameraFrame} facing="back" autofocus="on" />

        <View style={styles.targetLayer} pointerEvents="none">
          {visibleTargets.map((target) => {
            const index = TARGETS.findIndex((item) => item.id === target.id);
            const position =
              capturedCount === 0
                ? { x: CENTER.x + firstTargetOffset.x, y: CENTER.y + firstTargetOffset.y }
                : targetScreenPosition(target, pan);
            const captured = capturedIds.includes(target.id);
            const current = index === activeIndex;
            const dotSize = capturedCount === 0 && current ? firstDotSize(firstTargetVerticalDistance) : DOT_SIZE;
            const dotColor = motionWarning && !captured && !isFirstTarget ? RED : GREEN;
            const dot = (
              <Animated.View
                key={target.id}
                style={[
                  styles.dot,
                  {
                    borderRadius: dotSize / 2,
                    height: dotSize,
                    left: position.x - dotSize / 2,
                    top: position.y - dotSize / 2,
                    width: dotSize,
                    backgroundColor: dotColor,
                    opacity: captured ? 0.4 : 1,
                  },
                  current && capturedCount > 0 ? pulseStyle : null,
                ]}
              />
            );

            return dot;
          })}

          <View style={styles.reticleWrap}>
            <View style={styles.reticle}>
              <View
                style={[
                  styles.reticleFill,
                  {
                    transform: [{ scale: Math.max(0.02, holdProgress) }],
                    opacity: holdProgress > 0 ? 0.92 : 0,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.chevron,
                {
                  transform: [{ rotate: `${Math.atan2(activeOffset.y, activeOffset.x)}rad` }],
                },
              ]}
            >
              ›
            </Text>
          </View>
        </View>

        <SafeAreaView style={styles.captureChrome} pointerEvents="box-none">
          <View style={styles.topControls}>
            <TouchableOpacity style={styles.backButton} onPress={leaveCapture}>
              <Text style={styles.backButtonText}>↩</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeButton} onPress={leaveCapture}>
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>
          </View>

          {showNudge ? (
            <View style={styles.nudge}>
              <View style={styles.tiltIcon}>
                <View style={styles.phoneTilt} />
              </View>
              <Text style={styles.nudgeText}>{directionText(activeOffset)}</Text>
            </View>
          ) : null}

          <View style={styles.instructionWrap}>
            <Text style={styles.instructionText}>
              {motionWarning && !isFirstTarget
                ? "Return to your original spot before capturing."
                : capturedCount === 0
                  ? "Point your device at the blue target"
                  : "Shoot all photos from the same spot as your initial photo to ensure an optimal result."}
            </Text>
          </View>

          {capturedCount > 0 ? (
            <View style={styles.progressWrap}>
              <Text style={styles.progressCount}>
                {capturedCount} of {TARGETS.length}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.homeScreen}>
      <View style={styles.homeContent}>
        <Text style={styles.heading}>Capture</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={captureName}
            onChangeText={setCaptureName}
            placeholder="Tokyo Tower 🚀"
            placeholderTextColor={TEXT_MUTED}
          />

          <TouchableOpacity style={styles.primaryButton} onPress={beginCapture}>
            <Text style={styles.buttonText}>Begin capture</Text>
          </TouchableOpacity>

          <Text style={styles.orText}>or</Text>

          <TouchableOpacity style={styles.primaryButton}>
            <Text style={styles.buttonText}>Import 360° photo</Text>
          </TouchableOpacity>

          {queuedName ? (
            <View style={styles.queuedCard}>
              <Text style={styles.queuedTitle}>{queuedName}</Text>
              <Text style={styles.queuedStatus}>Enqueued</Text>
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  homeScreen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  homeContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 34,
  },
  heading: {
    color: "#000000",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 30,
  },
  form: {
    gap: 14,
  },
  label: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "700",
  },
  input: {
    backgroundColor: BUTTON,
    borderRadius: 999,
    color: "#000000",
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 22,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: BUTTON,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 22,
  },
  buttonText: {
    color: "#000000",
    fontSize: 16,
    fontWeight: "600",
  },
  orText: {
    alignSelf: "center",
    color: "#000000",
    fontSize: 15,
    marginVertical: 2,
  },
  queuedCard: {
    borderColor: BUTTON,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 18,
  },
  queuedTitle: {
    color: "#000000",
    fontSize: 17,
    fontWeight: "700",
  },
  queuedStatus: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 5,
  },
  captureScreen: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center",
  },
  cameraFrame: {
    aspectRatio: 0.75,
    borderColor: "#ffffff",
    borderWidth: 1.5,
    overflow: "hidden",
    width: "72%",
  },
  targetLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  dot: {
    borderRadius: DOT_SIZE / 2,
    height: DOT_SIZE,
    position: "absolute",
    width: DOT_SIZE,
  },
  reticleWrap: {
    alignItems: "center",
    height: RETICLE_SIZE,
    justifyContent: "center",
    left: CENTER.x - RETICLE_SIZE / 2,
    position: "absolute",
    top: CENTER.y - RETICLE_SIZE / 2,
    width: RETICLE_SIZE,
  },
  reticle: {
    alignItems: "center",
    borderColor: "#ffffff",
    borderRadius: RETICLE_SIZE / 2,
    borderWidth: 2.5,
    height: RETICLE_SIZE,
    justifyContent: "center",
    overflow: "hidden",
    width: RETICLE_SIZE,
  },
  reticleFill: {
    backgroundColor: GREEN,
    borderRadius: RETICLE_SIZE / 2,
    height: RETICLE_SIZE,
    width: RETICLE_SIZE,
  },
  chevron: {
    color: "#ffffff",
    fontSize: 54,
    fontWeight: "300",
    left: RETICLE_SIZE + 9,
    lineHeight: 54,
    position: "absolute",
  },
  captureChrome: {
    ...StyleSheet.absoluteFillObject,
  },
  topControls: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  backButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 27,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  backButtonText: {
    color: "#000000",
    fontSize: 34,
    fontWeight: "700",
    marginTop: -2,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#ff1f1f",
    borderRadius: 27,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  closeButtonText: {
    color: "#ffffff",
    fontSize: 34,
    fontWeight: "600",
    marginTop: -4,
  },
  nudge: {
    alignItems: "center",
    alignSelf: "center",
    gap: 8,
    marginTop: 18,
  },
  tiltIcon: {
    alignItems: "center",
    borderColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  phoneTilt: {
    backgroundColor: "#ffffff",
    borderRadius: 4,
    height: 32,
    transform: [{ rotate: "-38deg" }],
    width: 20,
  },
  nudgeText: {
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "400",
  },
  instructionWrap: {
    alignItems: "center",
    bottom: 126,
    left: 36,
    position: "absolute",
    right: 36,
  },
  instructionText: {
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "400",
    lineHeight: 27,
    textAlign: "center",
  },
  progressWrap: {
    bottom: 28,
    left: 24,
    position: "absolute",
    right: 24,
  },
  progressCount: {
    alignSelf: "flex-end",
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "500",
    marginBottom: 7,
  },
  progressTrack: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    height: 8,
    overflow: "hidden",
  },
  progressBar: {
    backgroundColor: GREEN,
    height: "100%",
  },
});

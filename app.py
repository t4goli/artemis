from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 180 * 1024 * 1024
FRAME_STORE = {}
UPLOAD_ROOT = Path("uploads")
UPLOAD_ROOT.mkdir(exist_ok=True)
HUGIN_BIN = Path(r"C:\Program Files\Hugin\bin")


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.post("/api/finalize")
def finalize():
    payload = request.get_json(silent=True) or {}
    images = payload.get("images", [])
    frame_ids = payload.get("frameIds", [])
    frames = payload.get("frames", [])
    session_id = safe_name(payload.get("sessionId", "default"))

    if frames:
        decoded_images = []
        frame_items = []
        for frame in frames:
            frame_id = frame.get("id")
            image = load_frame(session_id, frame_id)
            if image is not None:
                decoded_images.append(image)
                frame_items.append({**frame, "image": image})
    elif frame_ids:
        decoded_images = [image for frame_id in frame_ids if (image := load_frame(session_id, frame_id)) is not None]
        frame_items = []
    else:
        decoded_images = []
        frame_items = []
        for item in images:
            image_data = item.get("image") if isinstance(item, dict) else item
            image = decode_data_url(image_data)
            if image is None:
                return jsonify({"error": "One or more photos could not be decoded."}), 400
            decoded_images.append(image)

    if len(decoded_images) < 8:
        return jsonify({"error": "Capture more photos before finalizing."}), 400

    if frame_items:
        hugin_result = stitch_hugin_equirectangular(frame_items)
        if hugin_result is not None:
            result = encode_image(hugin_result, quality=95)
            if result is None:
                return jsonify({"error": "The Hugin 360 image could not be encoded."}), 500
            return jsonify({"image": result, "method": "hugin"})

        panorama = make_fallback_equirectangular(frame_items)
        result = encode_image(panorama)
        if result is None:
            return jsonify({"error": "The final 360 image could not be encoded."}), 500
        return jsonify({"image": result, "fallback": True})

    stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    status, panorama = stitcher.stitch(decoded_images)

    if status != cv2.Stitcher_OK:
        fallback = make_fallback_equirectangular(frame_items)
        result = encode_image(fallback)
        if result is not None:
            return jsonify({"image": result, "fallback": True, "warning": stitch_error_message(status)})
        return jsonify({"error": stitch_error_message(status), "status": int(status)}), 422

    panorama = crop_black_borders(panorama)
    panorama = make_equirectangular_projection(panorama)
    result = encode_image(panorama)
    if result is None:
        return jsonify({"error": "The final 360 image could not be encoded."}), 500

    return jsonify({"image": result})


@app.post("/api/frame")
def upload_frame():
    payload = request.get_json(silent=True) or {}
    session_id = safe_name(payload.get("sessionId", "default"))
    image = decode_data_url(payload.get("image"))

    if image is None:
        return jsonify({"error": "Frame could not be decoded."}), 400

    frame_id = uuid.uuid4().hex
    FRAME_STORE[frame_id] = image
    session_dir = UPLOAD_ROOT / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(session_dir / f"{frame_id}.jpg"), image, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    return jsonify({"id": frame_id})


def load_frame(session_id, frame_id):
    if not frame_id:
        return None
    if frame_id in FRAME_STORE:
        return FRAME_STORE[frame_id]

    frame_path = UPLOAD_ROOT / safe_name(session_id) / f"{safe_name(frame_id)}.jpg"
    if not frame_path.exists():
        return None

    image = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
    if image is not None:
        FRAME_STORE[frame_id] = image
    return image


def safe_name(value):
    return "".join(ch for ch in str(value) if ch.isalnum() or ch in ("-", "_"))[:80] or "default"


def decode_data_url(data_url):
    if not isinstance(data_url, str) or "," not in data_url:
        return None

    _, encoded = data_url.split(",", 1)
    try:
        image_bytes = base64.b64decode(encoded)
    except ValueError:
        return None

    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    return cv2.imdecode(image_array, cv2.IMREAD_COLOR)


def stitch_error_message(status):
    messages = {
        cv2.Stitcher_ERR_NEED_MORE_IMGS: "The final stitch needs more overlapping photos.",
        cv2.Stitcher_ERR_HOMOGRAPHY_EST_FAIL: (
            "The photos do not have enough reliable overlap. Try rotating slower with more detail in frame."
        ),
        cv2.Stitcher_ERR_CAMERA_PARAMS_ADJUST_FAIL: (
            "The camera path could not be estimated. Retake from one fixed spot."
        ),
    }
    return messages.get(status, "The final 360 stitch failed.")


def crop_black_borders(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return image

    x, y, w, h = cv2.boundingRect(max(contours, key=cv2.contourArea))
    return image[y : y + h, x : x + w]


def make_equirectangular_projection(image):
    height, width = image.shape[:2]
    output_width = 2048 if width <= 2048 else 4096
    output_height = output_width // 2

    background = cv2.resize(image, (output_width, output_height), interpolation=cv2.INTER_LINEAR)
    background = cv2.GaussianBlur(background, (0, 0), sigmaX=28, sigmaY=28)

    scale = output_width / width
    foreground_height = int(height * scale)

    if foreground_height > output_height:
        foreground_width = int(width * (output_height / height))
        foreground = cv2.resize(image, (foreground_width, output_height), interpolation=cv2.INTER_AREA)
        x = (output_width - foreground_width) // 2
        background[:, x : x + foreground_width] = foreground
        return background

    foreground = cv2.resize(image, (output_width, foreground_height), interpolation=cv2.INTER_AREA)
    y = (output_height - foreground_height) // 2
    background[y : y + foreground_height, :] = foreground
    return background


def stitch_hugin_equirectangular(frames):
    tools = find_hugin_tools()
    if tools is None:
        return None

    with tempfile.TemporaryDirectory(prefix="surround_hugin_") as temp_dir:
        work_dir = Path(temp_dir)
        image_items = write_hugin_input_images(frames, work_dir)
        if len(image_items) < 8:
            return None
        image_paths = [item["path"] for item in image_items]

        project = work_dir / "project.pto"
        posed_project = work_dir / "posed.pto"
        controls = work_dir / "controls.pto"
        optimised = work_dir / "optimised.pto"
        final_project = work_dir / "final.pto"
        output_prefix = work_dir / "stitched"

        try:
            run_hugin(
                tools["pto_gen"],
                ["-o", str(project), "-p", "0", "-f", "68", *map(str, image_paths)],
                work_dir,
                tools["bin"],
            )
            apply_hugin_pose_priors(project, posed_project, image_items)
            run_hugin(
                tools["cpfind"],
                [
                    "--prealigned",
                    "--sieve1size=160",
                    "--sieve2size=3",
                    "--minmatches=4",
                    "-o",
                    str(controls),
                    str(posed_project),
                ],
                work_dir,
                tools["bin"],
            )
            run_hugin(tools["cpclean"], ["-o", str(controls), str(controls)], work_dir, tools["bin"])
            run_hugin(tools["autooptimiser"], ["-a", "-m", "-s", "-o", str(optimised), str(controls)], work_dir, tools["bin"])
            run_hugin(
                tools["pano_modify"],
                [
                    "-o",
                    str(final_project),
                    "--projection=2",
                    "--fov=360x180",
                    "--canvas=4096x2048",
                    "--crop=0,4096,0,2048",
                    "--output-type=NORMAL",
                    "--ldr-file=JPG",
                    "--ldr-compression=95",
                    "--blender=ENBLEND",
                    str(optimised),
                ],
                work_dir,
                tools["bin"],
            )
            run_hugin(
                tools["hugin_executor"],
                ["/s", "/p", str(output_prefix), str(final_project)],
                work_dir,
                tools["bin"],
                timeout=420,
            )
        except (subprocess.SubprocessError, OSError):
            return None

        output_image = find_hugin_output(work_dir, output_prefix)
        if output_image is None:
            return None

        panorama = cv2.imread(str(output_image), cv2.IMREAD_COLOR)
        if panorama is None:
            return None
        return cv2.resize(panorama, (2048, 1024), interpolation=cv2.INTER_AREA)


def find_hugin_tools():
    names = ("pto_gen", "cpfind", "cpclean", "autooptimiser", "pano_modify", "hugin_executor")
    candidates = [HUGIN_BIN]
    path_env = os.environ.get("PATH", "")
    candidates.extend(Path(path) for path in path_env.split(os.pathsep) if path)

    tools = {}
    for name in names:
        found = shutil.which(name)
        if found is None:
            for candidate in candidates:
                executable = candidate / f"{name}.exe"
                if executable.exists():
                    found = str(executable)
                    break
        if found is None:
            return None
        tools[name] = found

    tools["bin"] = str(Path(tools["pto_gen"]).parent)
    return tools


def write_hugin_input_images(frames, work_dir):
    row_order = {"level": 0, "up": 1, "down": 2}
    ordered = sorted(frames, key=lambda frame: (row_order.get(frame.get("row", "level"), 0), int(frame.get("target", 0))))
    image_items = []

    for index, frame in enumerate(ordered):
        path = work_dir / f"frame_{index:03d}_{safe_name(frame.get('row', 'level'))}_{int(frame.get('target', 0)):02d}.jpg"
        cv2.imwrite(str(path), frame["image"], [int(cv2.IMWRITE_JPEG_QUALITY), 94])
        image_items.append({"path": path, "frame": frame})

    return image_items


def apply_hugin_pose_priors(source_project, output_project, image_items):
    image_index = 0
    lines = []

    for line in source_project.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("i ") and image_index < len(image_items):
            frame = image_items[image_index]["frame"]
            yaw = frame_yaw(frame)
            pitch = frame_pitch(frame)
            line = replace_pto_token(line, "y", f"{yaw:.3f}")
            line = replace_pto_token(line, "p", f"{pitch:.3f}")
            line = replace_pto_token(line, "r", "0")
            image_index += 1
        lines.append(line)

    output_project.write_text("\n".join(lines) + "\n", encoding="utf-8")


def frame_yaw(frame):
    if isinstance(frame.get("heading"), (int, float)):
        return normalize_hugin_angle(float(frame["heading"]))
    return normalize_hugin_angle((int(frame.get("target", 0)) + 0.5) * 10)


def frame_pitch(frame):
    row = frame.get("row", "level")
    if row == "up":
        return 58
    if row == "down":
        return -58
    return 0


def normalize_hugin_angle(angle):
    return ((angle + 180) % 360) - 180


def replace_pto_token(line, key, value):
    pattern = rf"(?<=\s){re.escape(key)}-?\d+(?:\.\d+)?"
    replacement = f"{key}{value}"
    if re.search(pattern, line):
        return re.sub(pattern, replacement, line, count=1)
    return f"{line} {replacement}"


def run_hugin(executable, args, work_dir, hugin_bin, timeout=180):
    env = os.environ.copy()
    env["PATH"] = hugin_bin + os.pathsep + env.get("PATH", "")
    completed = subprocess.run(
        [executable, *args],
        cwd=work_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, completed.args, completed.stdout, completed.stderr)


def find_hugin_output(work_dir, output_prefix):
    candidates = list(work_dir.glob(f"{output_prefix.name}*.jpg")) + list(work_dir.glob(f"{output_prefix.name}*.tif"))
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_size)


def make_fallback_equirectangular(frames):
    output_width = 2048
    output_height = 1024
    row_order = ("up", "level", "down")
    row_heights = (output_height // 3, output_height // 3, output_height - 2 * (output_height // 3))
    target_count = 36

    canvas = np.zeros((output_height, output_width, 3), dtype=np.uint8)
    y = 0
    for row_name, row_height in zip(row_order, row_heights):
        row_frames = [frame for frame in frames if frame.get("row", "level") == row_name]
        row_image = compose_single_row(row_frames, output_width, row_height, target_count)
        canvas[y : y + row_height, :] = row_image
        y += row_height

    return smooth_row_transitions(canvas, row_heights)


def compose_single_row(frames, width, height, target_count):
    accumulator = np.zeros((height, width, 3), dtype=np.float32)
    weights = np.zeros((height, width), dtype=np.float32)
    patch_width = int(width / 4.2)

    for frame in frames:
        image = frame["image"]
        target = int(frame.get("target", 0))
        x_center = int(((target + 0.5) / target_count) * width)
        x = x_center - patch_width // 2
        patch = prepare_patch(image, patch_width, height)
        feather = make_row_feather_mask(patch_width, height)
        paste_blended_wrapped(accumulator, weights, patch, feather, x, 0)

    if np.count_nonzero(weights) == 0:
        return np.zeros((height, width, 3), dtype=np.uint8)

    normalized = accumulator / np.maximum(weights[:, :, None], 1e-4)
    row = np.clip(normalized, 0, 255).astype(np.uint8)
    return fill_row_gaps(row, weights)


def prepare_patch(image, width, height):
    patch = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
    patch = cv2.GaussianBlur(patch, (0, 0), sigmaX=0.35, sigmaY=0.35)
    return match_patch_luminance(patch)


def match_patch_luminance(patch):
    lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB).astype(np.float32)
    l_channel = lab[:, :, 0]
    mean = float(np.mean(l_channel))
    std = float(np.std(l_channel))
    if std > 1:
        l_channel = (l_channel - mean) * (42 / std) + 136
    lab[:, :, 0] = np.clip(l_channel, 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)


def make_feather_mask(width, height):
    x = np.linspace(0, 1, width, dtype=np.float32)
    y = np.linspace(0, 1, height, dtype=np.float32)
    mx = 0.18 + 0.82 * (np.sin(np.clip(x, 0, 1) * np.pi) ** 0.45)
    my = 0.2 + 0.8 * (np.sin(np.clip(y, 0, 1) * np.pi) ** 0.5)
    mask = np.outer(my, mx)
    return np.clip(mask, 0, 1).astype(np.float32)


def make_row_feather_mask(width, height):
    x = np.linspace(0, 1, width, dtype=np.float32)
    y = np.linspace(0, 1, height, dtype=np.float32)
    mx = np.sin(np.clip(x, 0, 1) * np.pi) ** 0.55
    my = 0.12 + 0.88 * (np.sin(np.clip(y, 0, 1) * np.pi) ** 0.35)
    return np.outer(my, mx).astype(np.float32)


def paste_blended_wrapped(accumulator, weights, patch, feather, x, y):
    height, width = patch.shape[:2]
    canvas_height, canvas_width = weights.shape

    for offset in (0, canvas_width, -canvas_width):
        x0 = x + offset
        x1 = x0 + width
        if x1 <= 0 or x0 >= canvas_width:
            continue
        sx0 = max(0, -x0)
        sx1 = min(width, canvas_width - x0)
        dx0 = max(0, x0)
        dx1 = dx0 + (sx1 - sx0)
        dy0 = max(0, y)
        dy1 = min(canvas_height, y + height)
        if dy1 <= dy0:
            continue
        sy0 = dy0 - y
        sy1 = sy0 + (dy1 - dy0)
        alpha = feather[sy0:sy1, sx0:sx1]
        accumulator[dy0:dy1, dx0:dx1] += patch[sy0:sy1, sx0:sx1].astype(np.float32) * alpha[:, :, None]
        weights[dy0:dy1, dx0:dx1] += alpha


def smooth_equirectangular(image, weights):
    soft = cv2.GaussianBlur(image, (0, 0), sigmaX=2.2, sigmaY=2.2)
    row_soft = cv2.GaussianBlur(image, (0, 0), sigmaX=0.8, sigmaY=12)
    confidence = np.clip(weights / 2.2, 0, 1).astype(np.float32)
    low_confidence = 1 - confidence
    result = image.astype(np.float32) * confidence[:, :, None] + soft.astype(np.float32) * low_confidence[:, :, None]

    for boundary in (int(image.shape[0] * 0.34), int(image.shape[0] * 0.66)):
        start = max(0, boundary - 48)
        end = min(image.shape[0], boundary + 48)
        blend = np.linspace(0, 1, end - start, dtype=np.float32)
        blend = np.minimum(blend, 1 - blend) * 2
        result[start:end] = (
            result[start:end] * (1 - blend[:, None, None] * 0.55)
            + row_soft[start:end].astype(np.float32) * (blend[:, None, None] * 0.55)
        )

    return np.clip(result, 0, 255).astype(np.uint8)


def fill_row_gaps(row, weights):
    covered = weights > 0.04
    if np.all(covered):
        return row

    mask = np.where(covered, 0, 255).astype(np.uint8)
    blurred = cv2.GaussianBlur(row, (0, 0), sigmaX=24, sigmaY=4)
    base = np.where(mask[:, :, None] == 0, row, blurred)
    filled = cv2.inpaint(base, mask, 7, cv2.INPAINT_TELEA)
    alpha = np.clip(cv2.GaussianBlur(weights, (0, 0), sigmaX=3, sigmaY=1) / 0.8, 0, 1).astype(np.float32)
    result = row.astype(np.float32) * alpha[:, :, None] + filled.astype(np.float32) * (1 - alpha[:, :, None])
    return np.clip(result, 0, 255).astype(np.uint8)


def smooth_row_transitions(canvas, row_heights):
    result = canvas.copy()
    boundaries = np.cumsum(row_heights)[:-1]
    soft = cv2.GaussianBlur(canvas, (0, 0), sigmaX=0.8, sigmaY=10)

    for boundary in boundaries:
        start = max(0, boundary - 24)
        end = min(canvas.shape[0], boundary + 24)
        if end <= start:
            continue
        weight = np.linspace(0, 1, end - start, dtype=np.float32)
        weight = np.minimum(weight, 1 - weight) * 2
        result[start:end] = (
            result[start:end].astype(np.float32) * (1 - weight[:, None, None] * 0.35)
            + soft[start:end].astype(np.float32) * (weight[:, None, None] * 0.35)
        ).astype(np.uint8)

    return result


def fill_missing_areas(image, weights):
    missing = np.where(weights > 0.12, 0, 255).astype(np.uint8)
    if np.count_nonzero(missing) == 0:
        return image

    blurred = cv2.GaussianBlur(image, (0, 0), sigmaX=28, sigmaY=28)
    filled = cv2.inpaint(np.where(missing[:, :, None] == 0, image, blurred), missing, 11, cv2.INPAINT_TELEA)
    alpha = np.clip(cv2.GaussianBlur(weights, (0, 0), sigmaX=9, sigmaY=9) / 1.2, 0, 1).astype(np.float32)
    result = image.astype(np.float32) * alpha[:, :, None] + filled.astype(np.float32) * (1 - alpha[:, :, None])
    return np.clip(result, 0, 255).astype(np.uint8)


def encode_image(image, quality=92):
    ok, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return None

    result = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/jpeg;base64,{result}"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

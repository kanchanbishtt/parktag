import 'dart:typed_data';
import 'dart:ui' as ui;

import 'models.dart';

/// Long edges tried, in order, for an image still over [maxUploadBytes] after
/// the picker. Web document-compress.js LADDER rungs below the 2000px top one.
const shrinkEdges = [1600, 1400, 1200];

/// Web MAX_DECODE_BYTES: anything bigger is refused before it is decoded.
const maxDecodeBytes = 40 * 1024 * 1024;

const tooBigImageMessage =
    'This image is over 5MB. Choose a smaller image or a JPEG.';

/// Re-encodes [bytes] at [maxEdge] on the long edge. Null on failure.
typedef ImageEncoder = Future<Uint8List?> Function(
  Uint8List bytes,
  int maxEdge,
);

/// An oversized image, shrunk to fit.
class Shrunk {
  const Shrunk(this.bytes, this.filename);
  final Uint8List bytes;
  final String filename;
}

bool isShrinkableImage(String filename) {
  final type = uploadMediaType(filename)?.mimeType;
  return type == 'image/jpeg' || type == 'image/png' || type == 'image/webp';
}

/// Walks [shrinkEdges] until an encode fits under [maxUploadBytes]. Null when
/// nothing fits, the file is too big to decode, or encoding fails. Never throws.
Future<Shrunk?> shrinkToFit(
  Uint8List bytes,
  String filename, {
  ImageEncoder encode = encodePng,
}) async {
  if (!isShrinkableImage(filename) || bytes.length > maxDecodeBytes) {
    return null;
  }
  for (final edge in shrinkEdges) {
    try {
      final out = await encode(bytes, edge);
      if (out != null && out.isNotEmpty && out.length <= maxUploadBytes) {
        return Shrunk(out, _asPng(filename));
      }
    } catch (_) {
      return null;
    }
  }
  return null;
}

String _asPng(String filename) {
  final dot = filename.lastIndexOf('.');
  final base = dot > 0 ? filename.substring(0, dot) : 'document';
  return '$base.png';
}

/// dart:ui only encodes PNG, so that is what the shrunk file is.
// ponytail: PNG only, add a JPEG/WEBP encoder dependency if PNGs at 1200px
// still miss 5MB in practice.
Future<Uint8List?> encodePng(Uint8List bytes, int maxEdge) async {
  final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
  final desc = await ui.ImageDescriptor.encoded(buffer);
  final w = desc.width, h = desc.height;
  if (w <= 0 || h <= 0) return null;
  final scale = maxEdge / (w > h ? w : h);
  final codec = await desc.instantiateCodec(
    targetWidth: scale < 1 ? (w * scale).round().clamp(1, w) : w,
    targetHeight: scale < 1 ? (h * scale).round().clamp(1, h) : h,
  );
  final frame = await codec.getNextFrame();
  final data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
  frame.image.dispose();
  codec.dispose();
  desc.dispose();
  buffer.dispose();
  return data?.buffer.asUint8List();
}

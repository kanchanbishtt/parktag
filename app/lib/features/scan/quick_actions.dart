import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import '../more/support.dart' show supportWhatsApp;
import 'scan_io.dart';

/// Web FALLBACK_SUPPORT_WHATSAPP, used when the lookup sends no number.
const fallbackSupportWhatsapp = supportWhatsApp;
const _tagHost = 'https://app.parktag.me';

/// wa.me to support with the tag already named. Only the masked plate goes in:
/// it is on screen already, and the full plate is never known here.
Uri urgentSupportLink({
  required String token,
  String? maskedPlate,
  Object? supportWhatsapp,
}) {
  final configured = '${supportWhatsapp ?? ''}'.replaceAll(RegExp(r'\D'), '');
  final digits = configured.isEmpty ? fallbackSupportWhatsapp : configured;
  final plate = maskedPlate ?? 'unknown plate';
  final text =
      'Urgent: I scanned a ParkTag on vehicle $plate and need help right away.\nTag: $token';
  return Uri.parse('https://wa.me/$digits?text=${Uri.encodeComponent(text)}');
}

/// The sticker's own link.
String tagShareUrl(String token) => '$_tagHost/tag/$token';

/// Page-level actions under the contact card. None of them reaches the owner.
class QuickActions extends StatelessWidget {
  const QuickActions({
    super.key,
    required this.token,
    this.maskedPlate,
    this.supportWhatsapp,
  });

  final String token;
  final String? maskedPlate;
  final Object? supportWhatsapp;

  Future<void> _share(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    // Native share sheet first; copying is the web's fallback when it fails.
    try {
      await ScanIo.shareText(tagShareUrl(token));
      return;
    } catch (_) {}
    try {
      await Clipboard.setData(ClipboardData(text: tagShareUrl(token)));
      messenger.showSnackBar(const SnackBar(content: Text('Link copied.')));
    } on PlatformException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not copy the link.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(color: PtColors.muted, fontWeight: FontWeight.w600);
    return Wrap(
      alignment: WrapAlignment.center,
      children: [
        TextButton.icon(
          onPressed: () => ScanIo.launch(
            urgentSupportLink(
              token: token,
              maskedPlate: maskedPlate,
              supportWhatsapp: supportWhatsapp,
            ),
          ),
          icon: const Icon(Icons.chat_rounded, size: 16, color: PtColors.muted),
          label: const Text('Urgent, WhatsApp us', style: style),
        ),
        TextButton(
          onPressed: () => ScanIo.customTab(
            '$_tagHost/report-tag?tag=${Uri.encodeQueryComponent(token)}',
          ),
          child: const Text('Report wrong info', style: style),
        ),
        TextButton(
          onPressed: () => _share(context),
          child: const Text('Share', style: style),
        ),
      ],
    );
  }
}

/// Both trust lines, as on the web page.
class PrivacyNote extends StatelessWidget {
  const PrivacyNote({super.key});

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.lock_rounded, size: 14, color: PtColors.muted),
        SizedBox(width: 6),
        Flexible(
          child: Text(
            'Your privacy is protected. No personal details shared.',
            style: TextStyle(color: PtColors.muted, fontSize: 13),
          ),
        ),
      ],
    );
  }
}

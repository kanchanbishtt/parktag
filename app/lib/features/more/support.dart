import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../owner/owner_common.dart' show ownerLaunch;

/// Legal and contact pages live on the marketing site, the same links the
/// web dashboard uses (welcome.html Support and Legal). app.parktag.me does
/// not serve these paths.
const siteBase = 'https://parktag.me';
const termsUrl = '$siteBase/terms';
const privacyUrl = '$siteBase/privacy';
const refundUrl = '$siteBase/refund';
const supportUrl = '$siteBase/contact';

/// Same values as landing/app/contact/page.tsx and get.js SUPPORT_WHATSAPP.
const supportEmail = 'support@parktag.me';
const supportPhone = '+918791638854';
const supportWhatsApp = '918791638854';

final supportWhatsAppUri = Uri.parse(
    'https://wa.me/$supportWhatsApp?text=${Uri.encodeComponent('Hi! I need help with ParkTag.')}');

/// Bottom sheet with WhatsApp, email and call, like the web contact page.
Future<void> showContactSupport(BuildContext context) => showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              title: Text('Contact support',
                  style: TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('We usually reply the same day'),
            ),
            ListTile(
              leading: const Icon(Icons.chat_outlined, color: PtColors.whatsappDark),
              title: const Text('WhatsApp us'),
              subtitle: const Text('+91 87916 38854'),
              onTap: () => ownerLaunch(supportWhatsAppUri),
            ),
            ListTile(
              leading: const Icon(Icons.mail_outline, color: PtColors.accent),
              title: const Text('Email us'),
              subtitle: const Text(supportEmail),
              onTap: () => ownerLaunch(Uri.parse('mailto:$supportEmail')),
            ),
            ListTile(
              leading: const Icon(Icons.call_outlined, color: PtColors.navy),
              title: const Text('Call us'),
              subtitle: const Text('Mon to Sat, 10 am to 6 pm IST'),
              onTap: () => ownerLaunch(Uri.parse('tel:$supportPhone')),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );

import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// Ported from landing/app/components/FaqAccordion.tsx. Answers that quote a
/// live price use the landing fallback copy, and the first-year answer does
/// not point at buying Premium (Play policy).
const faqs = <(String, String)>[
  (
    'Are WhatsApp scan notifications a Premium feature?',
    'No. WhatsApp scan notifications are included for the life of every '
        'active ParkTag. The first included year covers Premium tools such as '
        'masked calls, callback, scanner location details, the document vault '
        'and SOS features.',
  ),
  (
    'Do I have to stick the ParkTag directly on my car?',
    'No. With the Duo Pack you can add the optional Clear Dashboard Plate: '
        '10 x 6 cm, 2 mm clear crystal acrylic. Stick your ParkTag on the '
        'plate, then place it on your dashboard instead of sticking it on the '
        'windscreen. It is never added automatically.',
  ),
  (
    'How does ParkTag work?',
    'You place a QR sticker on your vehicle. When someone scans it with any '
        'phone camera, you get notified instantly and can communicate '
        'anonymously through the ParkTag platform, without revealing your '
        'phone number.',
  ),
  (
    'Does the person scanning need an app?',
    'No. The scanner just uses their phone camera, it opens a webpage '
        'directly. No app, no sign-up, no friction. Only you (the vehicle '
        'owner) use the ParkTag app.',
  ),
  (
    'Will my phone number be shared?',
    'Never. Your name, number, and address are never visible to anyone who '
        'scans your tag. All contact goes through our anonymous platform.',
  ),
  (
    'What if I lose the sticker?',
    "Email us at support@parktag.me. You can deactivate the old tag "
        "instantly from the app, and we'll send you a replacement.",
  ),
  (
    'Which vehicles can use ParkTag?',
    'Any vehicle: cars, bikes, scooters, EVs, autos, trucks, bicycles. If it '
        'parks, it can use ParkTag.',
  ),
  (
    'What happens after the first year?',
    'Every tag includes one year of Premium. After that, the tag keeps '
        'working, WhatsApp scan notifications remain included, and your '
        'number stays private. Premium tools such as masked calling pause '
        'when the included year ends.',
  ),
  (
    'What if the tag arrives damaged or faulty?',
    'Tell us within 7 days of delivery with an unboxing photo or video and '
        'your order ID, and we will replace it. Unused, unscanned tags in '
        'their original packaging can also be returned within 7 days. '
        'Approved refunds go back to the original payment method in 7 to 10 '
        'business days.',
  ),
  (
    'How long does delivery take?',
    'Delivery is free on every order, anywhere in India. We ship within 1 to '
        '2 business days and delivery takes 2 to 4 business days, with a '
        'tracking number once dispatched. Cash on delivery is available on '
        'the Car Tag packs, for a small handling fee, where Delhivery accepts '
        'cash.',
  ),
];

/// One card of collapsible questions, like the landing accordion.
class FaqList extends StatelessWidget {
  const FaqList({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (final (q, a) in faqs)
            ExpansionTile(
              title: Text(q, style: const TextStyle(fontWeight: FontWeight.w700)),
              iconColor: PtColors.accent,
              collapsedIconColor: PtColors.accent,
              childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
              expandedAlignment: Alignment.centerLeft,
              children: [
                Text(a, style: const TextStyle(color: PtColors.muted, height: 1.4)),
              ],
            ),
        ],
      ),
    );
  }
}

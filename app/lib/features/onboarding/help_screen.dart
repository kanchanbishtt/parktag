import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../more/support.dart' show showContactSupport;
import 'faq.dart';

class _Section {
  const _Section(this.icon, this.title, this.points);

  final IconData icon;
  final String title;
  final List<String> points;
}

const _sections = [
  _Section(Icons.qr_code_scanner_rounded, 'When someone scans your tag', [
    'They scan the sticker with any phone camera or the ParkTag app.',
    'They confirm the last 4 digits of your vehicle number.',
    'They can send you a message or call you through a masked line.',
    'In an emergency, they can reach your SOS contact.',
  ]),
  _Section(Icons.verified_rounded, 'How to activate a new tag', [
    'Stick the tag where it is easy to see, like the windscreen.',
    'Open the Scan tab and scan your new sticker.',
    'Follow the steps to link it to your vehicle and number.',
  ]),
  _Section(Icons.lock_rounded, 'Your privacy', [
    'Your mobile number is never shown to the person who scans.',
    'Calls go through a masked number.',
    'Pause calls on any tag whenever you like.',
  ]),
];

/// `/help`: static explainer and FAQ. No demo API (it is off in production).
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Help & FAQ')),
      body: ListView(
        padding: const EdgeInsets.all(PtLayout.padX),
        children: [
          for (final s in _sections)
            Card(
              margin: const EdgeInsets.only(bottom: 14),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(s.icon, color: PtColors.accent),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(s.title,
                              style: const TextStyle(
                                  fontSize: 17, fontWeight: FontWeight.w800)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    for (final p in s.points)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('•  ',
                                style: TextStyle(color: PtColors.muted)),
                            Expanded(child: Text(p)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          const Padding(
            padding: EdgeInsets.fromLTRB(4, 8, 4, 10),
            child: Text('Frequently asked questions',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          ),
          const FaqList(),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            icon: const Icon(Icons.support_agent_outlined),
            label: const Text('Contact support'),
            onPressed: () => showContactSupport(context),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

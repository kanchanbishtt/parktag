import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Guest checkout needs reCAPTCHA, so guests buy on the web.
const buyTagUrl = 'https://app.parktag.me/get';

/// `/hub` for guests and `/home` for owners: the Home tab, a column of
/// action tiles. Owners see their tags where guests see Sign in, and buy
/// in the native shop.
class HubScreen extends StatelessWidget {
  const HubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final owner = AppScope.of(context).isOwner;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            PtLayout.padX,
            24,
            PtLayout.padX,
            100,
          ),
          children: [
            const PtLogo(height: 40),
            const SizedBox(height: 8),
            const Text(
              'Reach any parked car owner. Numbers stay private.',
              style: TextStyle(color: PtColors.muted, fontSize: 15),
            ),
            const SizedBox(height: 24),
            _Tile(
              icon: Icons.qr_code_2_rounded,
              title: 'Scan a tag',
              body: 'Contact the owner of a parked vehicle.',
              primary: true,
              onTap: () => context.go('/scan'),
            ),
            if (owner)
              _Tile(
                icon: Icons.local_offer_rounded,
                title: 'Your tags',
                body: 'Manage your tags and see who reached you.',
                onTap: () => context.go('/tags'),
              )
            else
              _Tile(
                icon: Icons.login_rounded,
                title: 'Sign in',
                body: 'Manage your tags and see who reached you.',
                onTap: () => context.push('/login'),
              ),
            _Tile(
              icon: Icons.local_mall_outlined,
              title: 'Buy a tag',
              body: 'Get a ParkTag sticker for your vehicle.',
              onTap: () => owner
                  ? context.go('/shop')
                  : PtPlatform.openCustomTab(buyTagUrl),
            ),
            _Tile(
              icon: Icons.help_outline_rounded,
              title: 'How it works',
              body: 'Scanning, activation and privacy.',
              onTap: () => context.push('/help'),
            ),
            _Tile(
              icon: Icons.local_shipping_outlined,
              title: 'Track an order',
              body: 'Order number and the last 4 digits of the phone.',
              onTap: () => context.push('/track-order'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({
    required this.icon,
    required this.title,
    required this.body,
    required this.onTap,
    this.primary = false,
  });

  final IconData icon;
  final String title;
  final String body;
  final VoidCallback onTap;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final fg = primary ? Colors.white : PtColors.ink;
    return Card(
      color: primary ? PtColors.accent : PtColors.panel,
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Icon(
                icon,
                size: 30,
                color: primary ? Colors.white : PtColors.accent,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: fg,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      body,
                      style: TextStyle(
                        color: primary ? Colors.white70 : PtColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: fg),
            ],
          ),
        ),
      ),
    );
  }
}

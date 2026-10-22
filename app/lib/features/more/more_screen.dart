import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'referral_card.dart';
import 'support.dart';

class MoreScreen extends StatefulWidget {
  const MoreScreen({super.key});

  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && AppScope.read(context).dashboard == null) _load();
    });
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      await AppScope.read(context).refresh();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _signOut() async {
    final app = AppScope.read(context);
    await app.signOut();
    if (mounted) context.go('/hub');
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final owner = app.owner;
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(PtLayout.padX, 8, PtLayout.padX, 120),
        children: [
          if (_error != null)
            ErrorCard.from(_error!, onRetry: _load)
          else if (owner == null)
            const Skeleton(rows: 1, height: 88)
          else
            Card(
              child: ListTile(
                contentPadding: const EdgeInsets.all(16),
                leading: const CircleAvatar(
                  backgroundColor: PtColors.amberBg,
                  child: Icon(Icons.person, color: PtColors.accent),
                ),
                title: Text(
                  owner.displayName.isNotEmpty ? owner.displayName : 'Your account',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(owner.email ?? owner.mobile ?? ''),
              ),
            ),
          const SizedBox(height: 12),
          if (referralShown(app.referral)) ...[
            ReferralCard(app.referral),
            const SizedBox(height: 8),
          ],
          _Row(Icons.person_outline, 'Profile', () => context.push('/more/profile')),
          _Row(Icons.local_shipping_outlined, 'Delivery address',
              () => context.push('/shop/address')),
          _Row(Icons.receipt_long_outlined, 'Orders', () => context.push('/shop/orders')),
          _Row(Icons.local_shipping_outlined, 'Track an order',
              () => context.push('/track-order')),
          _Row(Icons.pin_outlined, 'Login PIN & devices', () => context.push('/more/pin')),
          _Row(Icons.workspace_premium_outlined, 'Membership',
              () => context.push('/more/membership')),
          _Row(Icons.help_outline, 'Help & FAQ', () => context.push('/help')),
          _Row(Icons.support_agent_outlined, 'Contact support',
              () => showContactSupport(context)),
          _Row(Icons.description_outlined, 'Terms of service',
              () => PtPlatform.openCustomTab(termsUrl)),
          _Row(Icons.privacy_tip_outlined, 'Privacy policy',
              () => PtPlatform.openCustomTab(privacyUrl)),
          _Row(Icons.currency_exchange, 'Refund policy',
              () => PtPlatform.openCustomTab(refundUrl)),
          _Row(Icons.logout, 'Sign out', _signOut),
          _Row(Icons.delete_outline, 'Delete account',
              () => context.push('/more/delete-account'),
              danger: true),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.icon, this.label, this.onTap, {this.danger = false});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger ? PtColors.error : PtColors.ink;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(icon, color: color),
        title: Text(label,
            style: TextStyle(color: color, fontWeight: FontWeight.w600)),
        trailing: const Icon(Icons.chevron_right, color: PtColors.muted),
        onTap: onTap,
      ),
    );
  }
}

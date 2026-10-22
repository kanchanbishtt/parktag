import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'models.dart';

String? strOrNull(Object? v) => v is String && v.isNotEmpty ? v : null;

List<TrackScan> parseScans(Object? raw) => raw is List
    ? [for (final s in raw) if (s is Map<String, dynamic>) TrackScan.fromJson(s)]
    : const [];

/// track-order.js STATUS_LABELS and humanizeStatus.
String trackStatusLabel(String? status) => switch (status) {
      null || '' || 'processing' => 'Preparing to ship',
      'cod_confirmed' => 'Confirmed, Cash on Delivery',
      'booking_failed' => "Couldn't book courier yet. We'll retry",
      'booked' => 'Booked with courier',
      _ => status.replaceAll('_', ' '),
    };

/// Order header, status, courier timeline and the Delhivery link.
class TrackDetails extends StatelessWidget {
  const TrackDetails({
    super.key,
    required this.title,
    required this.status,
    required this.scans,
    this.orderNumber,
    this.waybill,
    this.trackingUrl,
  });

  final String title, status;
  final String? orderNumber, waybill, trackingUrl;
  final List<TrackScan> scans;

  @override
  Widget build(BuildContext context) {
    final url = Uri.tryParse(trackingUrl ?? '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        if (orderNumber != null)
          Text('Order $orderNumber', style: const TextStyle(color: PtColors.muted)),
        if (waybill != null)
          Text('Waybill $waybill', style: const TextStyle(color: PtColors.muted)),
        const SizedBox(height: 12),
        Text(status, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        if (scans.isEmpty)
          const EmptyState(
              title: 'No courier updates yet',
              body: 'Updates appear here once the courier picks up your parcel.',
              icon: Icons.local_shipping_outlined)
        else
          for (final s in scans)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading:
                  const Icon(Icons.radio_button_checked, color: PtColors.accent, size: 18),
              title: Text(trackStatusLabel(s.status)),
              subtitle: Text([
                if (s.location.isNotEmpty) s.location,
                if (s.dateTime != null) shortDate(s.dateTime!),
                if (s.instructions.isNotEmpty) s.instructions,
              ].join('\n')),
            ),
        if (url != null && url.scheme == 'https')
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => launchUrl(url, mode: LaunchMode.externalApplication),
              icon: const Icon(Icons.open_in_new, size: 18),
              label: const Text('Open on Delhivery'),
            ),
          ),
      ],
    );
  }
}

/// `/track-order`: public lookup by order number and the last 4 digits of the
/// delivery phone (POST /api/shop/track-order, no sign-in, no reCAPTCHA).
class TrackOrderScreen extends StatefulWidget {
  const TrackOrderScreen({super.key, this.initialOrderNumber});

  final String? initialOrderNumber;

  @override
  State<TrackOrderScreen> createState() => _TrackOrderScreenState();
}

class _TrackOrderScreenState extends State<TrackOrderScreen> {
  late final _order = TextEditingController(text: widget.initialOrderNumber ?? '');
  final _lastFour = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, dynamic>? _result;

  @override
  void dispose() {
    _order.dispose();
    _lastFour.dispose();
    super.dispose();
  }

  Future<void> _lookUp() async {
    final orderNumber = _order.text.trim();
    final lastFour = _lastFour.text.trim();
    // Checked here only to say which field is wrong, as the web page does.
    final problem = orderNumber.isEmpty
        ? 'Enter your order ID to continue.'
        : !RegExp(r'^\d{4}$').hasMatch(lastFour)
            ? 'Enter the last 4 digits of the delivery phone number.'
            : null;
    setState(() {
      _error = problem;
      if (problem == null) _busy = true;
    });
    if (problem != null) return;
    try {
      final res = await AppScope.read(context).api.post('/api/shop/track-order',
          {'orderNumber': orderNumber, 'lastFour': lastFour});
      final order = res['order'];
      if (mounted) setState(() => _result = order is Map<String, dynamic> ? order : {});
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _result = null;
        _error = e.status == 429
            ? 'Too many lookups just now. Wait a minute and try again.'
            : e.message;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    return Scaffold(
      appBar: AppBar(title: const Text('Track an order')),
      body: ListView(
        padding: const EdgeInsets.all(PtLayout.padX),
        children: [
          TextField(
            controller: _order,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
                labelText: 'Order ID', hintText: 'e.g. PT-260728-00042'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _lastFour,
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(4),
            ],
            decoration: const InputDecoration(
                labelText: 'Last 4 digits of the delivery phone number', hintText: '1234'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: PtColors.error)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _lookUp,
            child: Text(_busy ? 'Looking up your order' : 'Track order'),
          ),
          if (r != null) ...[
            const SizedBox(height: 24),
            TrackDetails(
              title: strOrNull(r['productName']) ?? 'Your order',
              orderNumber: strOrNull(r['orderNumber']),
              waybill: strOrNull(r['waybill']),
              status: trackStatusLabel(strOrNull(r['shippingStatus'])),
              scans: parseScans(r['scans']),
              trackingUrl: strOrNull(r['trackingUrl']),
            ),
          ],
        ],
      ),
    );
  }
}

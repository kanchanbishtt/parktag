import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'models.dart';
import 'track_order_screen.dart';

/// `/shop/orders`.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  late Future<List<ShopOrder>> _future = _load();

  Future<List<ShopOrder>> _load() async {
    final res = await AppScope.read(context).api.get('/api/owner/orders');
    final list = res['orders'];
    return list is List
        ? [for (final o in list) if (o is Map<String, dynamic>) ShopOrder.fromJson(o)]
        : const [];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My orders')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _future = _load());
          await _future.catchError((_) => const <ShopOrder>[]);
        },
        child: FutureBuilder<List<ShopOrder>>(
          future: _future,
          builder: (context, snap) {
            final pad = const EdgeInsets.all(PtLayout.padX);
            if (snap.hasError) {
              return ListView(padding: pad, children: [
                ErrorCard.from(snap.error!,
                    onRetry: () => setState(() => _future = _load())),
              ]);
            }
            if (!snap.hasData) return Padding(padding: pad, child: const Skeleton());
            final orders = snap.data!;
            if (orders.isEmpty) {
              return ListView(children: const [
                EmptyState(
                    title: 'No orders yet',
                    body: 'Tags you buy show up here with tracking.',
                    icon: Icons.local_shipping_outlined),
              ]);
            }
            return ListView.separated(
              padding: pad,
              itemCount: orders.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, i) {
                final o = orders[i];
                return Card(
                  child: ListTile(
                    title: Text(o.productName,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text([
                      if (o.orderNumber.isNotEmpty) o.orderNumber,
                      '${formatRupees(o.amountPaise)} ${o.cod ? 'COD' : 'paid'}',
                      shippingLabel(o.status),
                      if (o.orderedAt != null) shortDate(o.orderedAt!),
                    ].join('\n')),
                    isThreeLine: true,
                    // Only orders with a waybill have a courier timeline.
                    trailing: o.trackable ? const Icon(Icons.chevron_right) : null,
                    onTap: o.trackable && o.id.isNotEmpty
                        ? () => context.push('/shop/orders/${o.id}')
                        : null,
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

/// `/shop/orders/:id`: the courier timeline.
class TrackScreen extends StatefulWidget {
  const TrackScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<TrackScreen> createState() => _TrackScreenState();
}

class _TrackScreenState extends State<TrackScreen> {
  late Future<Map<String, dynamic>> _future = _load();

  Future<Map<String, dynamic>> _load() => AppScope.read(context)
      .api
      .get('/api/owner/orders/${Uri.encodeComponent(widget.orderId)}/track');

  @override
  Widget build(BuildContext context) {
    const pad = EdgeInsets.all(PtLayout.padX);
    return Scaffold(
      appBar: AppBar(title: const Text('Track order')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) {
            return ListView(padding: pad, children: [
              ErrorCard.from(snap.error!,
                  onRetry: () => setState(() => _future = _load())),
            ]);
          }
          if (!snap.hasData) return const Padding(padding: pad, child: Skeleton());
          final t = snap.data!;
          return ListView(padding: pad, children: [
            TrackDetails(
              title: '${t['productName'] ?? 'Order'}',
              orderNumber: strOrNull(t['orderNumber']),
              waybill: strOrNull(t['waybill']),
              status: trackStatusLabel(strOrNull(t['status'])),
              scans: parseScans(t['scans']),
              trackingUrl: strOrNull(t['trackingUrl']),
            ),
          ]);
        },
      ),
    );
  }
}

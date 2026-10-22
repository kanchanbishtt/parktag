import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// States and union territories as the courier label needs them written
/// (address-step.js STATES). A dropdown, so "UP" and "U.P." never ship.
const indianStates = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

/// [raw] as written in [indianStates], matched case-insensitively, or null.
String? canonicalState(String? raw) {
  final want = (raw ?? '').trim().toLowerCase();
  for (final s in indianStates) {
    if (s.toLowerCase() == want) return s;
  }
  return null;
}

/// City (district) and state for a pincode.
typedef PinPlace = ({String city, String? state});

/// India Post's answer, as address-step.js lookupPin reads it.
PinPlace? parsePostOffice(Object? data) {
  if (data is! List || data.isEmpty) return null;
  final first = data.first;
  if (first is! Map || first['Status'] != 'Success') return null;
  final offices = first['PostOffice'];
  if (offices is! List || offices.isEmpty || offices.first is! Map) return null;
  final office = offices.first as Map;
  final district = office['District'];
  return (
    city: district is String ? district : '',
    state: canonicalState(office['State'] as String?),
  );
}

typedef PinLookup = Future<PinPlace?> Function(String pin);

/// India Post's public PIN lookup, the same one the web calls. Best effort:
/// a slow or failed lookup returns null and the buyer types by hand.
@visibleForTesting
PinLookup pinLookup = _indiaPost;

Future<PinPlace?> lookupPin(String pin) => pinLookup(pin);

Future<PinPlace?> _indiaPost(String pin) async {
  try {
    final res = await http
        .get(Uri.parse('https://api.postalpincode.in/pincode/$pin'))
        .timeout(const Duration(seconds: 4));
    return res.statusCode == 200 ? parsePostOffice(jsonDecode(res.body)) : null;
  } catch (_) {
    return null;
  }
}

/// The web's pincode/state check, or null when they agree or are unknown.
String? pinStateProblem(PinPlace? place, String state) =>
    place?.state != null && place!.state != state
        ? 'That pincode is in ${place.state}, not $state. '
            "Please check your area's postal code."
        : null;

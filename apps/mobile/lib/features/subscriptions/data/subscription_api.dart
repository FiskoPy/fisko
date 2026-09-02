import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

/// A plan as the server defines it. Prices live on the server so a price change
/// never requires shipping a new build to the stores.
class Plan {
  Plan({
    required this.id,
    required this.name,
    required this.priceGs,
    required this.invoiceLimit,
    required this.ocrPerDay,
    required this.features,
    required this.checkout,
  });

  final String id;
  final String name;

  /// Null when the price is negotiated (Empresarial) or free.
  final int? priceGs;

  /// Null means unlimited.
  final int? invoiceLimit;
  final int ocrPerDay;
  final List<String> features;

  /// 'pagopar' → can be bought in-app. 'contacto' → talk to sales.
  final String checkout;

  bool get isFree => id == 'gratis';
  bool get canBuy => checkout == 'pagopar' && priceGs != null;

  factory Plan.fromJson(Map<String, dynamic> j) => Plan(
        id: j['id'] as String,
        name: j['name'] as String,
        priceGs: (j['priceGs'] as num?)?.toInt(),
        invoiceLimit: (j['invoiceLimit'] as num?)?.toInt(),
        ocrPerDay: (j['ocrPerDay'] as num?)?.toInt() ?? 0,
        features: ((j['features'] as List?) ?? const []).map((e) => e.toString()).toList(),
        checkout: (j['checkout'] as String?) ?? 'contacto',
      );
}

/// What the logged-in user currently has.
class MySubscription {
  MySubscription({required this.planId, required this.status, this.currentPeriodEnd});

  final String planId;

  /// active | pending | expired | cancelled | none
  final String status;
  final DateTime? currentPeriodEnd;

  bool get isActive => status == 'active';

  factory MySubscription.fromJson(Map<String, dynamic> j) {
    final plan = j['plan'] as Map<String, dynamic>?;
    return MySubscription(
      planId: (plan?['id'] as String?) ?? 'gratis',
      status: (j['status'] as String?) ?? 'none',
      currentPeriodEnd: j['currentPeriodEnd'] != null
          ? DateTime.tryParse(j['currentPeriodEnd'] as String)
          : null,
    );
  }
}

class SubscriptionApi {
  SubscriptionApi(this._dio);

  final Dio _dio;

  Future<List<Plan>> plans() async {
    final res = await _dio.get<Map<String, dynamic>>('/subscriptions/plans');
    final list = (res.data!['plans'] as List).cast<Map<String, dynamic>>();
    return list.map(Plan.fromJson).toList();
  }

  Future<MySubscription> mine() async {
    final res = await _dio.get<Map<String, dynamic>>('/subscriptions/me');
    return MySubscription.fromJson(res.data!);
  }

  /// Returns the Pagopar URL the user must open to pay.
  Future<String> checkout(String planId) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/subscriptions/checkout',
      data: {'planId': planId},
    );
    return res.data!['redirectUrl'] as String;
  }
}

final subscriptionApiProvider =
    Provider<SubscriptionApi>((ref) => SubscriptionApi(ref.watch(dioProvider)));

final plansProvider = FutureProvider.autoDispose<List<Plan>>(
  (ref) => ref.watch(subscriptionApiProvider).plans(),
);

/// Not autoDispose: the plan gates features across screens, so it should stay
/// warm rather than refetch every time the user opens Perfil.
final mySubscriptionProvider = FutureProvider<MySubscription>(
  (ref) => ref.watch(subscriptionApiProvider).mine(),
);

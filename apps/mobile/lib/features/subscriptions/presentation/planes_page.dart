import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/errors/error_message.dart';
import '../../../core/format.dart';
import '../../../core/theme/app_theme.dart';
import '../data/subscription_api.dart';

/// Plan catalogue and checkout. Marco 2 phase 2F.
class PlanesPage extends ConsumerStatefulWidget {
  const PlanesPage({super.key});

  @override
  ConsumerState<PlanesPage> createState() => _PlanesPageState();
}

class _PlanesPageState extends ConsumerState<PlanesPage> {
  String? _busyPlanId;

  Future<void> _subscribe(Plan plan) async {
    setState(() => _busyPlanId = plan.id);
    try {
      final url = await ref.read(subscriptionApiProvider).checkout(plan.id);
      if (!mounted) return;

      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo abrir la página de pago.')),
        );
        return;
      }
      if (!mounted) return;
      // The webhook credits the plan, and it can land after the browser closes.
      // Re-read on return rather than assuming success.
      ref.invalidate(mySubscriptionProvider);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cuando termines el pago, volvé acá y actualizá para ver tu plan.'),
          duration: Duration(seconds: 5),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(friendlyError(e)),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busyPlanId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final plansAsync = ref.watch(plansProvider);
    final mine = ref.watch(mySubscriptionProvider);
    final currentId = mine.valueOrNull?.planId ?? 'gratis';

    return Scaffold(
      appBar: AppBar(title: const Text('Planes')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(plansProvider);
          ref.invalidate(mySubscriptionProvider);
        },
        child: plansAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(
            children: [
              const SizedBox(height: 160),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(friendlyError(e), textAlign: TextAlign.center),
              ),
            ],
          ),
          data: (plans) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            children: [
              if (mine.valueOrNull?.isActive == true &&
                  mine.valueOrNull?.currentPeriodEnd != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Tu plan se renueva el ${formatDate(mine.value!.currentPeriodEnd!)}.',
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.outline,
                    ),
                  ),
                ),
              for (final p in plans)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _PlanCard(
                    plan: p,
                    isCurrent: p.id == currentId,
                    busy: _busyPlanId == p.id,
                    anyBusy: _busyPlanId != null,
                    onSubscribe: () => _subscribe(p),
                  ),
                ),
              const SizedBox(height: 8),
              Text(
                'Los precios son mensuales, en guaraníes. El cobro se hace por Pagopar. '
                'Podés cambiar de plan cuando quieras.',
                style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.outline),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.plan,
    required this.isCurrent,
    required this.busy,
    required this.anyBusy,
    required this.onSubscribe,
  });

  final Plan plan;
  final bool isCurrent;
  final bool busy;
  final bool anyBusy;
  final VoidCallback onSubscribe;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fisko = theme.extension<FiskoColors>()!;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isCurrent ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
          width: isCurrent ? 2 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(plan.name, style: theme.textTheme.titleMedium),
                const SizedBox(width: 8),
                if (isCurrent)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: fisko.iva5.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      'Tu plan',
                      style: TextStyle(fontSize: 11, color: fisko.iva5, fontWeight: FontWeight.w600),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              plan.priceGs != null
                  ? formatGs(plan.priceGs!)
                  : plan.isFree
                      ? 'Sin costo'
                      : 'Precio a convenir',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
                fontFeatures: AppTheme.tabularFigures,
              ),
            ),
            if (plan.priceGs != null)
              Text(
                'por mes',
                style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
              ),
            const SizedBox(height: 14),
            for (final f in plan.features)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.check, size: 16, color: fisko.iva5),
                    const SizedBox(width: 8),
                    Expanded(child: Text(f, style: const TextStyle(fontSize: 13))),
                  ],
                ),
              ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: _action(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _action(BuildContext context) {
    if (isCurrent) {
      return const OutlinedButton(onPressed: null, child: Text('Plan actual'));
    }
    if (plan.isFree) {
      return const SizedBox.shrink();
    }
    if (!plan.canBuy) {
      // Empresarial: the price is negotiated, so there is nothing to charge.
      return OutlinedButton.icon(
        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Escribinos y armamos un plan a tu medida.'),
            duration: Duration(seconds: 4),
          ),
        ),
        icon: const Icon(Icons.chat_bubble_outline, size: 18),
        label: const Text('Hablar con nosotros'),
      );
    }
    return FilledButton(
      onPressed: anyBusy ? null : onSubscribe,
      child: busy
          ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
          : Text('Suscribirme a ${plan.name}'),
    );
  }
}

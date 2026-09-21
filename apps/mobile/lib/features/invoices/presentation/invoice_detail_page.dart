import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/errors/error_message.dart';
import '../application/invoices_controller.dart';
import '../data/invoices_repository.dart';
import '../data/models/invoice_models.dart';
import 'invoice_format.dart';

final invoiceDetailProvider = FutureProvider.family<Invoice, String>((ref, id) {
  return ref.watch(invoicesRepositoryProvider).detail(id);
});

class InvoiceDetailPage extends ConsumerWidget {
  const InvoiceDetailPage({required this.id, super.key});

  final String id;

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Eliminar factura'),
        content: const Text('¿Seguro que querés eliminar esta factura?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(invoicesControllerProvider.notifier).deleteInvoice(id);
    if (context.mounted) context.pop();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(invoiceDetailProvider(id));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Factura'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _confirmDelete(context, ref),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(friendlyError(e), textAlign: TextAlign.center),
          ),
        ),
        data: (inv) => _Detail(invoice: inv),
      ),
    );
  }
}

class _Detail extends ConsumerWidget {
  const _Detail({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inv = invoice;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(inv.emisorNombre, style: Theme.of(context).textTheme.titleLarge),
        Text('RUC ${inv.emisorRuc}${inv.emisorDv != null ? '-${inv.emisorDv}' : ''}'),
        const SizedBox(height: 8),
        _row('Tipo', tipoDocLabel(inv.tipoDoc, inv.tipoDocDesc)),
        _row('Fecha', formatDocDate(inv.fechaEmision)),
        _TipoRow(invoice: inv),
        _CategoriaRow(invoice: inv),
        if (inv.receptorNombre != null) _row('Receptor', inv.receptorNombre!),
        _row('CDC', inv.cdc, mono: true),
        const Divider(height: 24),
        // The paper prints the GROSS amount as "TOTAL GRAVADAS" (IVA
        // included); what the app stores as the base is the NET one, as SIFEN
        // does. Showing only the net under "Base gravada" invited a comparison
        // with the ticket that could never match, so show both, labelled.
        _row('Total gravado 5% (con IVA)', formatMoney(inv.baseGrav5 + inv.iva5, inv.moneda)),
        _row('Base imponible 5% (sin IVA)', formatMoney(inv.baseGrav5, inv.moneda)),
        _row('IVA 5%', formatMoney(inv.iva5, inv.moneda)),
        _row('Total gravado 10% (con IVA)', formatMoney(inv.baseGrav10 + inv.iva10, inv.moneda)),
        _row('Base imponible 10% (sin IVA)', formatMoney(inv.baseGrav10, inv.moneda)),
        _row('IVA 10%', formatMoney(inv.iva10, inv.moneda)),
        _row('Total IVA', formatMoney(inv.totalIva, inv.moneda)),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('TOTAL', style: TextStyle(fontWeight: FontWeight.bold)),
            Text(formatMoney(inv.totalOpe, inv.moneda),
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.bold,
                    )),
          ],
        ),
        // In guaraníes: the figure this factura carries into the month's IVA.
        if ((inv.moneda).toUpperCase() != 'PYG') _TipoCambioRow(invoice: inv),
        const Divider(height: 24),
        Text('Ítems (${inv.items?.length ?? 0})',
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...?inv.items?.map((it) => _ItemTile(item: it, moneda: inv.moneda)),
      ],
    );
  }

  Widget _row(String label, String value, {bool mono = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Colors.grey))),
          Expanded(
            child: Text(
              value,
              style: mono ? const TextStyle(fontFamily: 'monospace', fontSize: 12) : null,
            ),
          ),
        ],
      ),
    );
  }
}

/// A foreign invoice in guaraníes, and where its rate came from: the invoice
/// itself, the DNIT's close of the day before (the law's rate when the
/// invoice prints none), or typed by hand — which can be corrected here.
class _TipoCambioRow extends ConsumerStatefulWidget {
  const _TipoCambioRow({required this.invoice});

  final Invoice invoice;

  @override
  ConsumerState<_TipoCambioRow> createState() => _TipoCambioRowState();
}

class _TipoCambioRowState extends ConsumerState<_TipoCambioRow> {
  bool _saving = false;

  /// A rate the invoice itself carries is the one the law takes, and stays.
  bool get _editable => widget.invoice.tipoCambioFuente != null || widget.invoice.tipoCambio == null;

  Future<void> _edit() async {
    final inv = widget.invoice;
    final field = TextEditingController(
      text: inv.tipoCambio != null ? formatRate(inv.tipoCambio!) : '',
    );
    // '__dnit__' goes back to the DNIT's close; a number is typed by hand.
    final chosen = await showDialog<Object>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Tipo de cambio'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Guaraníes por cada ${inv.moneda}.'),
            const SizedBox(height: 8),
            TextField(
              controller: field,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(hintText: 'Ej.: 5.921,39'),
            ),
          ],
        ),
        actions: [
          if (inv.tipoCambioFuente != 'dnit')
            TextButton(
              onPressed: () => Navigator.pop(ctx, '__dnit__'),
              child: const Text('Usar cotización DNIT'),
            ),
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, parseRate(field.text) ?? '__invalid__'),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    field.dispose();
    if (chosen == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    if (chosen == '__invalid__') {
      messenger.showSnackBar(const SnackBar(content: Text('Escribí el tipo de cambio, por ejemplo 5.921,39.')));
      return;
    }

    setState(() => _saving = true);
    try {
      await ref
          .read(invoicesRepositoryProvider)
          .setTipoCambio(inv.id, chosen == '__dnit__' ? null : chosen as double);
      ref.invalidate(invoiceDetailProvider(inv.id));
      ref.read(invoicesControllerProvider.notifier).refreshAfterChange();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = widget.invoice;
    final theme = Theme.of(context);
    final converted = formatConverted(inv.totalOpe, inv.moneda, inv.tipoCambio);
    final source = switch (inv.tipoCambioFuente) {
      // A purchase is converted at the selling rate, a sale at the buying one.
      'dnit' => 'La factura no trae tipo de cambio: cotización DNIT '
          '(${inv.tipo == 'venta' ? 'compra' : 'venta'}) del '
          '${inv.tipoCambioFecha != null ? formatIsoDay(inv.tipoCambioFecha!) : 'día anterior'}.',
      'manual' => 'Tipo de cambio cargado a mano.',
      _ => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          converted ?? 'Sin tipo de cambio: queda fuera de los totales en guaraníes.',
          style: converted != null
              ? TextStyle(color: theme.colorScheme.outline)
              : TextStyle(color: theme.colorScheme.error, fontSize: 12),
        ),
        if (source != null)
          Text(source,
              textAlign: TextAlign.end,
              style: TextStyle(color: theme.colorScheme.outline, fontSize: 12)),
        if (_editable)
          _saving
              ? const Padding(
                  padding: EdgeInsets.all(8),
                  child: SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                )
              : TextButton.icon(
                  onPressed: _edit,
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: const Text('Corregir tipo de cambio'),
                ),
      ],
    );
  }
}

/// Sale or purchase — the side of the IVA this invoice falls on, and a way to
/// correct it when the RUC does not settle it.
class _TipoRow extends ConsumerStatefulWidget {
  const _TipoRow({required this.invoice});

  final Invoice invoice;

  @override
  ConsumerState<_TipoRow> createState() => _TipoRowState();
}

class _TipoRowState extends ConsumerState<_TipoRow> {
  bool _saving = false;

  Future<void> _pick() async {
    final inv = widget.invoice;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              title: const Text('Venta (factura emitida)'),
              subtitle: const Text('Su IVA es débito fiscal'),
              trailing: inv.tipo == 'venta' ? const Icon(Icons.check) : null,
              onTap: () => Navigator.pop(ctx, 'venta'),
            ),
            ListTile(
              title: const Text('Compra o gasto (factura recibida)'),
              subtitle: const Text('Su IVA es crédito fiscal computable'),
              trailing: inv.tipo == 'compra' ? const Icon(Icons.check) : null,
              onTap: () => Navigator.pop(ctx, 'compra'),
            ),
            if (inv.tipoManual)
              ListTile(
                leading: const Icon(Icons.auto_fix_high_outlined),
                title: const Text('Volver a decidirlo por el RUC'),
                onTap: () => Navigator.pop(ctx, '__auto__'),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(invoicesRepositoryProvider)
          .setTipo(inv.id, chosen == '__auto__' ? null : chosen);
      ref.invalidate(invoiceDetailProvider(inv.id));
      ref.read(invoicesControllerProvider.notifier).refreshAfterChange();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = widget.invoice;
    final venta = inv.tipo == 'venta';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text('Tipo'),
          _saving
              ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton.icon(
                  onPressed: _pick,
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: Text(
                    venta ? 'Venta · IVA débito' : 'Compra o gasto · IVA crédito',
                  ),
                ),
        ],
      ),
    );
  }
}

/// What the invoice is filed under — and a way to correct it.
///
/// The rules read the issuer and the items, and cannot know everything: the
/// client's agrochemicals were landing in "Otros". What he corrects stays
/// corrected; what he leaves alone follows the rules, so a better ruleset
/// still reaches it.
class _CategoriaRow extends ConsumerStatefulWidget {
  const _CategoriaRow({required this.invoice});

  final Invoice invoice;

  @override
  ConsumerState<_CategoriaRow> createState() => _CategoriaRowState();
}

class _CategoriaRowState extends ConsumerState<_CategoriaRow> {
  bool _saving = false;

  static const _options = <String, String>{
    'insumos_agricolas': 'Insumos agrícolas',
    'combustible': 'Combustible',
    'supermercado': 'Supermercado y despensa',
    'alimentacion': 'Alimentación',
    'servicios_basicos': 'Servicios básicos',
    'telecomunicaciones': 'Telecomunicaciones',
    'transporte': 'Transporte',
    'salud': 'Salud',
    'educacion': 'Educación',
    'tecnologia': 'Tecnología',
    'financiero': 'Financiero',
    'alquiler': 'Alquiler',
    'vestimenta': 'Vestimenta',
    'otros': 'Otros',
  };

  Future<void> _pick() async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final e in _options.entries)
              ListTile(
                title: Text(e.value),
                trailing: e.key == widget.invoice.categoria ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(ctx, e.key),
              ),
            if (widget.invoice.categoriaManual)
              ListTile(
                leading: const Icon(Icons.auto_fix_high_outlined),
                title: const Text('Volver a la categoría automática'),
                onTap: () => Navigator.pop(ctx, '__auto__'),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(invoicesRepositoryProvider)
          .setCategoria(widget.invoice.id, chosen == '__auto__' ? null : chosen);
      ref.invalidate(invoiceDetailProvider(widget.invoice.id));
      ref.read(invoicesControllerProvider.notifier).refreshAfterChange();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = widget.invoice;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text('Categoría'),
          _saving
              ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton.icon(
                  onPressed: _pick,
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: Text(
                    inv.categoriaLabel + (inv.categoriaManual ? '' : ' (automática)'),
                  ),
                ),
        ],
      ),
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item, required this.moneda});

  final InvoiceItem item;

  /// Items are priced in the invoice currency; rendering them as guaraníes
  /// made a USD line look ~7000x cheaper than it is.
  final String moneda;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      title: Text(item.descripcion, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        '${item.cantidad.toStringAsFixed(item.cantidad % 1 == 0 ? 0 : 3)} × '
        '${formatMoney(item.precioUnit, moneda)} · IVA ${item.ivaRate}%',
      ),
      trailing: Text(formatMoney(item.total, moneda)),
    );
  }
}

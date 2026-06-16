import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format.dart';
import '../data/email_api.dart';

/// "Conectar correo" — connect a mailbox (Gmail app password) and pull SIFEN
/// DTE XML attachments automatically. Outlook personal accounts need OAuth
/// (coming soon); Gmail works today with an app password (2FA enabled).
class ConectarEmailPage extends ConsumerWidget {
  const ConectarEmailPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(emailConnectionsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Conectar correo')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openConnectSheet(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Conectar casilla'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(emailConnectionsProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(
            children: [const SizedBox(height: 160), Center(child: Text('Error: $e'))],
          ),
          data: (conns) => conns.isEmpty ? _empty(context) : _list(context, ref, conns),
        ),
      ),
    );
  }

  Widget _empty(BuildContext context) => ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 100),
          const Icon(Icons.mark_email_unread_outlined, size: 64),
          const SizedBox(height: 12),
          const Center(child: Text('Sin casillas conectadas')),
          const SizedBox(height: 8),
          Text(
            'Conectá tu correo para que Fisko importe automáticamente las facturas '
            'electrónicas (XML del DTE) que recibís como adjunto.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.outline),
          ),
        ],
      );

  Widget _list(BuildContext context, WidgetRef ref, List<EmailConnection> conns) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        for (final c in conns) _ConnectionTile(connection: c),
      ],
    );
  }

  Future<void> _openConnectSheet(BuildContext context, WidgetRef ref) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: _ConnectForm(
          onConnected: () {
            ref.invalidate(emailConnectionsProvider);
            Navigator.of(context).pop();
          },
        ),
      ),
    );
  }
}

class _ConnectionTile extends ConsumerStatefulWidget {
  const _ConnectionTile({required this.connection});

  final EmailConnection connection;

  @override
  ConsumerState<_ConnectionTile> createState() => _ConnectionTileState();
}

class _ConnectionTileState extends ConsumerState<_ConnectionTile> {
  bool _busy = false;

  Future<void> _sync() async {
    setState(() => _busy = true);
    try {
      final res = await ref.read(emailApiProvider).sync(widget.connection.id, sinceDays: 90);
      if (!mounted) return;
      final msg = res.imported > 0
          ? 'Importadas ${res.imported} factura(s)'
              '${res.duplicated > 0 ? ', ${res.duplicated} ya existían' : ''}.'
          : res.scanned == 0
              ? 'No se encontraron facturas nuevas en el correo.'
              : 'Sin facturas nuevas (${res.duplicated} ya estaban importadas).';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      ref.invalidate(emailConnectionsProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('No se pudo sincronizar: ${_msg(e)}')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disconnect() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Desconectar casilla'),
        content: Text('¿Desconectar ${widget.connection.email}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Desconectar')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(emailApiProvider).disconnect(widget.connection.id);
      ref.invalidate(emailConnectionsProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('No se pudo desconectar: ${_msg(e)}')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.connection;
    final last = c.lastSyncAt != null ? formatDate(c.lastSyncAt!) : null;
    final info = c.lastSyncInfo;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          children: [
            ListTile(
              leading: CircleAvatar(child: Text(c.provider.substring(0, 1).toUpperCase())),
              title: Text(c.email),
              subtitle: Text(
                last == null
                    ? 'Sin sincronizar todavía'
                    : 'Última sincronización: $last'
                        '${info != null ? ' · ${info.imported} importadas' : ''}',
              ),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: _busy ? null : _disconnect,
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 8, bottom: 4),
                child: FilledButton.tonalIcon(
                  onPressed: _busy ? null : _sync,
                  icon: _busy
                      ? const SizedBox(
                          height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.sync),
                  label: const Text('Sincronizar ahora'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConnectForm extends ConsumerStatefulWidget {
  const _ConnectForm({required this.onConnected});

  final VoidCallback onConnected;

  @override
  ConsumerState<_ConnectForm> createState() => _ConnectFormState();
}

class _ConnectFormState extends ConsumerState<_ConnectForm> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String _provider = 'gmail';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(emailApiProvider).connect(
            provider: _provider,
            email: _email.text.trim(),
            appPassword: _password.text.trim(),
          );
      widget.onConnected();
    } catch (e) {
      setState(() => _error = _msg(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Conectar casilla', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _provider,
              decoration: const InputDecoration(labelText: 'Proveedor'),
              items: const [
                DropdownMenuItem(value: 'gmail', child: Text('Gmail')),
                DropdownMenuItem(value: 'outlook', child: Text('Outlook')),
              ],
              onChanged: (v) => setState(() => _provider = v ?? 'gmail'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              decoration: const InputDecoration(labelText: 'Correo electrónico'),
              validator: (v) =>
                  (v == null || !v.contains('@')) ? 'Ingresá un correo válido' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Contraseña de aplicación',
                helperText: 'Gmail: creá una "contraseña de aplicación" (requiere verificación en 2 pasos).',
                helperMaxLines: 3,
              ),
              validator: (v) =>
                  (v == null || v.trim().length < 4) ? 'Ingresá la contraseña de aplicación' : null,
            ),
            if (_provider == 'outlook')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Nota: las cuentas personales de Outlook pueden requerir conexión por OAuth '
                  '(próximamente). Si tu casilla permite IMAP con contraseña de aplicación, funcionará.',
                  style: TextStyle(fontSize: 12),
                ),
              ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Conectar'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _msg(Object e) {
  if (e is DioException) {
    final data = e.response?.data;
    if (data is Map && data['error'] is Map && data['error']['message'] != null) {
      return data['error']['message'].toString();
    }
    return e.message ?? 'Error de red';
  }
  final s = e.toString();
  return s.length > 140 ? '${s.substring(0, 140)}…' : s;
}

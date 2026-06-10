import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/application/auth_controller.dart';

/// Drop-in helper that shows a SnackBar whenever the auth controller emits an
/// error or info message, then clears it. Wrap a page body with this.
class AuthMessageListener extends ConsumerWidget {
  const AuthMessageListener({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(authControllerProvider, (prev, next) {
      final messenger = ScaffoldMessenger.of(context);
      if (next.errorMessage != null && next.errorMessage != prev?.errorMessage) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(next.errorMessage!),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
        ref.read(authControllerProvider.notifier).clearMessages();
      } else if (next.infoMessage != null && next.infoMessage != prev?.infoMessage) {
        messenger.showSnackBar(SnackBar(content: Text(next.infoMessage!)));
        ref.read(authControllerProvider.notifier).clearMessages();
      }
    });
    return child;
  }
}

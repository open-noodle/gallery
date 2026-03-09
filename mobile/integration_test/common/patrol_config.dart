import 'package:patrol/patrol.dart';

/// Default Patrol configuration for all Immich integration tests.
const patrolConfig = PatrolTesterConfig(
  // Timeout for finding widgets
  existsTimeout: Duration(seconds: 15),
  // Timeout for settling after interactions
  settleTimeout: Duration(seconds: 15),
  // Settle policy: wait for animations
  settlePolicy: SettlePolicy.trySettle,
);

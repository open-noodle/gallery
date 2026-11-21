import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/networking/external_endpoints.dart';
import 'package:immich_mobile/models/auth/auxilary_endpoint.model.dart';

void main() {
  for (final url in [
    'https://photos.example.com',
    'http://192.168.1.2:2283',
    'https://photos.example.com/gallery/api',
    'http://[::1]:2283',
    '  https://photos.example.com  ',
  ]) {
    test('accepts $url without a network request', () => expect(isExternalEndpointUrl(url), isTrue));
  }

  for (final url in [
    '',
    '  ',
    'photos.example.com',
    'https://',
    '/gallery',
    'ftp://photos.example.com',
    'mailto:a@b',
  ]) {
    test('rejects unsupported address $url', () => expect(isExternalEndpointUrl(url), isFalse));
  }

  test('keeps every reachability status in configured order and trims whitespace', () {
    expect(
      externalEndpointUrls(const [
        AuxilaryEndpoint(url: ' https://failed.example.com ', status: AuxCheckStatus.error),
        AuxilaryEndpoint(url: 'http://reachable.example.com:2283', status: AuxCheckStatus.valid),
        AuxilaryEndpoint(url: 'https://pending.example.com/path', status: AuxCheckStatus.loading),
        AuxilaryEndpoint(url: 'https://unknown.example.com', status: AuxCheckStatus.unknown),
        AuxilaryEndpoint(url: '', status: AuxCheckStatus.unknown),
        AuxilaryEndpoint(url: 'ftp://unsupported.example.com', status: AuxCheckStatus.valid),
      ]),
      [
        'https://failed.example.com',
        'http://reachable.example.com:2283',
        'https://pending.example.com/path',
        'https://unknown.example.com',
      ],
    );
  });
}

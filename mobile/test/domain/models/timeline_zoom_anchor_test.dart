import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';

void main() {
  test('none anchor is empty and value comparable', () {
    expect(const TimelineZoomAnchor.none().isEmpty, isTrue);
    expect(const TimelineZoomAnchor.none(), const TimelineZoomAnchor.none());
    expect(const TimelineZoomAnchor.none().toString(), 'TimelineZoomAnchor.none()');
  });

  test('year anchor stores the selected year', () {
    const anchor = TimelineZoomAnchor.year(2025);

    expect(anchor.isEmpty, isFalse);
    expect(anchor, isA<TimelineZoomYearAnchor>());
    expect((anchor as TimelineZoomYearAnchor).year, 2025);
    expect(anchor, const TimelineZoomAnchor.year(2025));
    expect(anchor.toString(), 'TimelineZoomAnchor.year(2025)');
  });

  test('month anchor stores year and month', () {
    final anchor = TimelineZoomAnchor.month(year: 2025, month: 3);

    expect(anchor.isEmpty, isFalse);
    expect(anchor, isA<TimelineZoomMonthAnchor>());
    expect((anchor as TimelineZoomMonthAnchor).year, 2025);
    expect(anchor.month, 3);
    expect(anchor, TimelineZoomAnchor.month(year: 2025, month: 3));
    expect(anchor.toString(), 'TimelineZoomAnchor.month(year: 2025, month: 3)');
  });

  test('month anchor validates month ranges', () {
    expect(() => TimelineZoomAnchor.month(year: 2025, month: 0), throwsRangeError);
    expect(() => TimelineZoomAnchor.month(year: 2025, month: 13), throwsRangeError);
    expect(TimelineZoomAnchor.month(year: 2025, month: 1), isA<TimelineZoomMonthAnchor>());
    expect(TimelineZoomAnchor.month(year: 2025, month: 12), isA<TimelineZoomMonthAnchor>());
  });

  test('date anchor stores the target date', () {
    final date = DateTime(2017, 11, 15);
    final anchor = TimelineZoomAnchor.date(date);

    expect(anchor.isEmpty, isFalse);
    expect(anchor, isA<TimelineZoomDateAnchor>());
    expect((anchor as TimelineZoomDateAnchor).date, date);
    expect(anchor, TimelineZoomAnchor.date(date));
    expect(anchor, isNot(TimelineZoomAnchor.date(DateTime(2017, 11, 16))));
    expect(anchor.toString(), 'TimelineZoomAnchor.date($date)');
  });
}

import 'package:app/router.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  String? guest(String p) => guardRedirect(Uri.parse(p), isOwner: false);
  String? owner(String p) => guardRedirect(Uri.parse(p), isOwner: true);

  test('guest guard', () {
    expect(guest('/home'), '/hub');
    expect(guest('/tags'), '/login');
    expect(guest('/tags/abc/vault'), '/login');
    expect(guest('/more'), '/login');
    expect(guest('/shop/orders'), '/login');
    expect(guest('/activity?tag=x'), '/login');
    expect(guest('/add-vehicles'), '/login');
    expect(guest('/track-order?order=PT1'), isNull);
    expect(guest('/hub'), isNull);
    expect(guest('/scan'), isNull);
    expect(guest('/t/abc'), isNull);
    expect(guest('/login/web'), isNull);
  });

  test('owner guard', () {
    expect(owner('/hub'), '/home');
    expect(owner('/login'), '/home');
    expect(owner('/onboarding'), '/home');
    expect(owner('/tags/abc'), isNull);
    expect(owner('/scan'), isNull);
  });

  test('App Links', () {
    final t = 'a' * 64;
    expect(tagLinkRedirect(Uri.parse('/tag/$t')), '/t/$t');
    expect(tagLinkRedirect(Uri.parse('/vehicle/$t/')), '/t/$t');
    expect(tagLinkRedirect(Uri.parse('/tag?token=$t')), '/t/$t');
    expect(tagLinkRedirect(Uri.parse('/tag/short')), '/scan');
    expect(tagLinkRedirect(Uri.parse('https://app.parktag.me/tag/$t')), '/t/$t');
    expect(tagIdLinkRedirect('65f0c0ffee0123456789abcd'), '/tags/65f0c0ffee0123456789abcd');
    expect(tagIdLinkRedirect('../x'), '/home');
    expect(tagIdLinkRedirect('abc', 'etag'), '/tags/abc?open=etag');
    expect(tagIdLinkRedirect('abc', 'replacement'), '/tags/abc?open=replacement');
    expect(tagIdLinkRedirect('abc', 'evil'), '/tags/abc');
    expect(tagIdLinkRedirect('../x', 'etag'), '/home');
  });
}

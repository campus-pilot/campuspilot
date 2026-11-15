import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bestLink, linkTexts } from './screen-links';

const exams = [
  { text: 'Periodic Test 1 Exam plan generated Completed Completed Nov 14, 2026', href: '/school/s/sessions/x/exam/periodic-test-1' },
  { text: 'First Term Examination Exam plan generated Completed Completed Nov 14, 2026', href: '/school/s/sessions/x/exam/first-term-examination' },
  { text: 'Second Term Examination Exam plan generated Not started', href: '/school/s/sessions/x/exam/second-term-examination' },
  { text: 'Annual Examination Exam plan generated Not started', href: '/school/s/sessions/x/exam/annual-examination' },
];

describe('bestLink', () => {
  it('finds a card by the name written on it, whatever else the card says', () => {
    assert.equal(bestLink('Second Term Examination', exams)?.href, '/school/s/sessions/x/exam/second-term-examination');
    // "Exam" is on every card, so it does not stand in the way.
    assert.equal(bestLink('second term exam', exams)?.href, '/school/s/sessions/x/exam/second-term-examination');
    assert.equal(bestLink('second term', exams)?.href, '/school/s/sessions/x/exam/second-term-examination');
    assert.equal(bestLink('the annual examination', exams)?.href, '/school/s/sessions/x/exam/annual-examination');
    assert.equal(bestLink('annual examination', exams)?.href, '/school/s/sessions/x/exam/annual-examination');
  });

  it('ignores case and punctuation', () => {
    const classes = [{ text: 'Class 8-B', href: '/c/8b' }, { text: 'Class 8-A', href: '/c/8a' }];
    assert.equal(bestLink('class 8 b', classes)?.href, '/c/8b');
  });

  it('prefers the exact name, then the closer one: "Class 1" is not "Class 10"', () => {
    const classes = [{ text: 'Class 10', href: '/c/10' }, { text: 'Class 1', href: '/c/1' }];
    assert.equal(bestLink('Class 1', classes)?.href, '/c/1');
  });

  it('follows nothing when two places match equally, so the user can say which', () => {
    const students = [{ text: 'Arjun Patel', href: '/s/1' }, { text: 'Arjun Reddy', href: '/s/2' }];
    assert.equal(bestLink('Arjun', students), null);
    assert.equal(bestLink('Arjun Reddy', students)?.href, '/s/2');
  });

  it('treats two links to the same place as one', () => {
    const same = [{ text: 'Aanya Menon', href: '/s/1' }, { text: 'Aanya Menon', href: '/s/1' }];
    assert.equal(bestLink('Aanya Menon', same)?.href, '/s/1');
  });

  it('follows nothing for a name that is not on the screen', () => {
    assert.equal(bestLink('Unit Test 3', exams), null);
    assert.equal(bestLink('', exams), null);
  });
});

describe('bestLink in a sidebar', () => {
  const sidebar = [
    { text: 'School', href: '/settings' },
    { text: 'Templates', href: '/settings/templates' },
    { text: 'Examination', href: '/settings/templates/exam' },
    { text: 'ID card', href: '/settings/templates/id-card' },
    { text: 'Admit card', href: '/settings/templates/admit-card' },
    { text: 'View', href: '/demo' },
  ];

  it('opens a short link the request names in more words', () => {
    assert.equal(bestLink('admit card templates', sidebar)?.href, '/settings/templates/admit-card');
    assert.equal(bestLink('the admit card templates page', sidebar)?.href, '/settings/templates/admit-card');
    assert.equal(bestLink('ID card template', sidebar)?.href, '/settings/templates/id-card');
  });

  it('never opens a one-word link only because a longer request contains its word', () => {
    assert.equal(bestLink('view the results of class 5', sidebar), null);
  });
});

describe('linkTexts', () => {
  it('lists each link’s text once, tidied and capped', () => {
    assert.deepEqual(linkTexts([{ text: ' Billing ', href: '/a' }, { text: 'Billing', href: '/b' }, { text: '', href: '/c' }, { text: 'Staff', href: '/d' }]), ['Billing', 'Staff']);
    assert.equal(linkTexts(Array.from({ length: 60 }, (_, index) => ({ text: `Link ${index}`, href: `/${index}` }))).length, 40);
  });
});

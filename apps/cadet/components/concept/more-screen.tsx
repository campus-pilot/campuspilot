import {
  BellRingIcon,
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  LogOutIcon,
  PhoneIcon,
  SmartphoneIcon,
  UserRoundIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@campuspilot/ui/components/avatar';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@campuspilot/ui/components/item';
import { Badge } from '@campuspilot/ui/components/reui/badge';

import { ScreenHeader, SectionLabel } from './concept-shell';
import { siblings, student } from './mock-data';

function ProfileCard() {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback className="bg-primary/10 font-semibold text-primary">{student.initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-semibold">{student.name}</span>
            <span className="text-xs text-muted-foreground">Adm. {student.admissionNo}</span>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div className="flex flex-col"><dt className="text-muted-foreground">Class</dt><dd className="font-medium">7 · B</dd></div>
          <div className="flex flex-col"><dt className="text-muted-foreground">Roll</dt><dd className="font-medium">{student.rollNo}</dd></div>
          <div className="flex flex-col"><dt className="text-muted-foreground">Guardian</dt><dd className="font-medium">{student.guardian}</dd></div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Future guardian accounts: one sign-in, switch between children. Today each child has its own login. */
function ChildSwitcher() {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel action={<Badge variant="info-light" radius="full">Guardian accounts · later</Badge>}>Your children</SectionLabel>
      <ItemGroup className="gap-0 rounded-lg border">
        {siblings.map((child, index) => (
          <Item key={child.name} className="rounded-none border-b border-b-border last:border-b-0">
            <ItemMedia>
              <Avatar size="sm">
                <AvatarFallback className="text-[0.625rem]">{child.initials}</AvatarFallback>
              </Avatar>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{child.name}</ItemTitle>
              <ItemDescription>{child.className}</ItemDescription>
            </ItemContent>
            <ItemActions>{index === 0 ? <CheckIcon className="size-4 text-primary" /> : null}</ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}

const settings = [
  { icon: BellRingIcon, title: 'Notifications', description: 'Results, fee reminders, notices' },
  { icon: PhoneIcon, title: 'WhatsApp updates', description: '+91 98•••••210' },
  { icon: SmartphoneIcon, title: 'Install app', description: 'Add Cadet Portal to your home screen' },
  { icon: BotIcon, title: 'Connected AI apps', description: 'Ask an assistant about your results' },
  { icon: KeyRoundIcon, title: 'Change password', description: 'Issued by school on 12 Jun 2026' },
  { icon: UserRoundIcon, title: 'School contact', description: 'Office · 9:00 am – 2:00 pm' },
];

function SettingsList() {
  return (
    <ItemGroup className="gap-0 rounded-lg border">
      {settings.map(({ icon: Icon, title, description }) => (
        <Item key={title} className="rounded-none border-b border-b-border last:border-b-0">
          <ItemMedia variant="icon">
            <Icon className="text-muted-foreground" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{title}</ItemTitle>
            <ItemDescription>{description}</ItemDescription>
          </ItemContent>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </Item>
      ))}
    </ItemGroup>
  );
}

export function MoreScreen() {
  return (
    <>
      <ScreenHeader title="More" />
      <ProfileCard />
      <ChildSwitcher />
      <SettingsList />
      <Button variant="outline" size="lg" className="w-full">
        <LogOutIcon data-icon="inline-start" /> Sign out
      </Button>
    </>
  );
}

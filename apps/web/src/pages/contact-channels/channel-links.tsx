import { ArrowRight, ArrowUpRight } from "lucide-react";

import { channelTarget, type Channel } from "./channels";

/** Screen-reader hint appended to links that open a new tab. */
function NewTabHint({ channel }: { channel: Channel }) {
  return channel.external ? <span className="pg-cc-sr"> (opens in a new tab)</span> : null;
}

function ChannelIcon({ channel }: { channel: Channel }) {
  const Icon = channel.icon;
  return (
    <span className="pg-cc-icon" data-channel={channel.id} aria-hidden="true">
      <Icon />
    </span>
  );
}

type ChannelRowProps = {
  channel: Channel;
  /** Adds the "Recommended" tag and the accent treatment. */
  recommended?: boolean;
};

/**
 * Compact, full-width channel link: icon, name, the env-provided destination
 * and a short action. Used where channels sit beside another primary action
 * (the scheduler on `/book-demo`).
 */
export function ChannelRow({ channel, recommended = false }: ChannelRowProps) {
  return (
    <a className="pg-cc-row" href={channel.href} data-recommended={recommended || undefined} {...channelTarget(channel)}>
      <ChannelIcon channel={channel} />
      <span className="pg-cc-row-text">
        <b>
          {channel.name}
          {recommended ? <em>Recommended</em> : null}
        </b>
        <small>{channel.value}</small>
      </span>
      <span className="pg-cc-row-action">
        {channel.action} <ArrowUpRight aria-hidden="true" />
      </span>
      <NewTabHint channel={channel} />
    </a>
  );
}

type ChannelCardProps = {
  channel: Channel;
  /** Small uppercase line above the name ("Speak directly"). */
  kicker: string;
  description: string;
  recommended?: boolean;
};

/**
 * Large channel card: the whole card is one link so it is a single, generous
 * tap target on phones. Used as the main content of `/contact`.
 */
export function ChannelCard({ channel, kicker, description, recommended = false }: ChannelCardProps) {
  return (
    <a className="pg-cc-card" href={channel.href} data-recommended={recommended || undefined} {...channelTarget(channel)}>
      <span className="pg-cc-card-top">
        <ChannelIcon channel={channel} />
        <small>{recommended ? "Recommended" : kicker}</small>
      </span>
      <b className="pg-cc-card-name">{channel.name}</b>
      <span className="pg-cc-card-description">{description}</span>
      <span className="pg-cc-card-value">{channel.value}</span>
      <span className="pg-cc-card-action">
        {channel.action} <ArrowRight aria-hidden="true" />
      </span>
      <NewTabHint channel={channel} />
    </a>
  );
}

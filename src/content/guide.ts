/**
 * The Guide tab's content — one markdown string, edited here and nowhere
 * else. No component in src/app/guide reads copy from anywhere but this
 * file, so wording can change without touching code, and every instance
 * that clones this template inherits it unless they choose to edit it.
 */
export const GUIDE_MARKDOWN = `
## Overview

This dashboard is the operating system behind your public site — the "back office." It manages your content pipeline, leads, email sequences, social posting, bookings, and automation. Your public website reads from the same database this dashboard writes to, so anything you approve or publish here shows up there.

## Leads / CRM

Every form submission on your site — contact forms, lead magnets, booking requests — lands in **Leads**. Each lead has a status (new, engaged, qualified, converted, lost), tags, and an activity timeline showing every email, note, and stage change. The **Pipeline** view groups leads into deal stages so you can see where everyone stands at a glance. **Funnel** shows conversion rates between stages over time.

## Content pipeline

Content moves through five stages: **Planned → Approved → Writing → Draft → Published**. New ideas can be added by you or by the automated trend scan. Approve an idea to queue it for writing; the AI writer drafts the article (including a hero image) and drops it in **Draft** for review.

**Safe mode vs. autonomous mode:** in Safe Mode, every drafted article waits for a human to hit Publish before it goes live. In Autonomous Mode, articles publish automatically once written. Start in Safe Mode until you trust the output — you can switch anytime from the Content tab.

## Social

Connect your social accounts once, then create posts (image, video, or carousel) from the **Social** tab. Posts can be scheduled or published immediately. Performance numbers (reach, engagement) roll up under Social → Performance once accounts are connected.

## Bookings

Once a scheduling provider is connected, booked calls automatically create or update a lead, tag them, and open an opportunity in your pipeline. Reminder emails (24 hours and 1 hour before the call) send automatically — no manual follow-up needed.

## Email & sequences

**Workflows** are automated sequences: a trigger (a new lead, a tag, a status change) enrolls someone, and a series of steps — send an email, wait, add a tag, move a pipeline stage — runs automatically over time. Build sequences visually in the Workflows tab. Every send is logged against the lead's timeline, and opens/clicks roll up per workflow.

## Automation

A scheduled engine tick runs in the background every few minutes, checking for anything that's due: workflow steps, scheduled social posts, booking reminders. You don't need to trigger any of this manually — it runs continuously once workflows and posts are active. Manual "run now" controls exist for testing, but production automation is meant to run unattended.

## Settings

**Setup** is where you configure sender identity, safe mode, send windows and budgets (rate limits, bounce/complaint circuit breakers), and connect external accounts (email, social, booking). Brand context — your voice, positioning, and the links the AI uses in article CTAs — also lives here, and is what makes AI-written content sound like you instead of generic filler.
`.trim();

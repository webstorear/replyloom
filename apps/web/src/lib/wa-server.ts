import { createServerFn } from "@tanstack/react-start"
import { env } from "cloudflare:workers"
import { MAX_MEDIA_BYTES, isWorkspaceMediaKey, readMedia } from "@workspace/media-storage"
import { applySafeMediaHeaders } from "@workspace/db"
import { getCurrentUser, requireCurrentPermission } from "./auth"
import { readEngineJson } from "./wa-engine"

type SendResult = { ok: boolean }

/** Current workspace; with a permission, also enforces the member's role. */
async function requireWorkspace(permission?: string) {
  if (permission) return requireCurrentPermission(permission)
  const auth = await getCurrentUser()
  if (!auth?.workspaceId) throw new Error("Unauthorized")
  return auth.workspaceId
}

export const serverRefreshProfile = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string; jid: string }) => data)
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("view_inbox")
    return readEngineJson<{
      ok: boolean
      jid: string
      avatarUrl: string | null
      about: string | null
    }>(`/session/${data.sessionId}/refresh-profile`, workspaceId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jid: data.jid }),
    })
  })

export const serverConnectSession = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_integrations")
    return readEngineJson<{ ok: boolean; message: string }>(
      `/session/${data.sessionId}/connect`,
      workspaceId,
      { method: "POST" }
    )
  })

export const serverSendMsg = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string; to: string; text: string }) => data)
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<SendResult>(
      `/session/${data.sessionId}/send`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: data.to, text: data.text }),
      }
    )
  })

export const serverDisconnectSession = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_integrations")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/disconnect`,
      workspaceId,
      { method: "POST" }
    )
  })

export const serverSendMedia = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      type: "image" | "video" | "audio" | "document"
      caption?: string
      fileBase64: string
      fileName: string
      fileMime: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    const bytes = Uint8Array.from(atob(data.fileBase64), (char) =>
      char.charCodeAt(0)
    )
    const form = new FormData()
    form.set("to", data.to)
    form.set("type", data.type)
    form.set("file", new File([bytes], data.fileName, { type: data.fileMime }))
    if (data.caption) form.set("caption", data.caption)

    return readEngineJson<SendResult>(
      `/session/${data.sessionId}/send-media`,
      workspaceId,
      { method: "POST", body: form }
    )
  })

export const serverSendTemplate = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      text?: string
      mediaKey?: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<SendResult>(
      `/session/${data.sessionId}/send-template`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          text: data.text,
          mediaKey: data.mediaKey,
        }),
      }
    )
  })

export const serverUploadMedia = createServerFn({ method: "POST" })
  .validator(
    (data: { fileBase64: string; fileName: string; fileMime: string }) => data
  )
  .handler(async ({ data }) => {
    if (data.fileBase64.length > 4 * Math.ceil(MAX_MEDIA_BYTES / 3)) {
      throw new Error("Media library files must be 5 MiB or smaller.")
    }
    const workspaceId = await requireWorkspace("send_messages")
    const bytes = Uint8Array.from(atob(data.fileBase64), (char) =>
      char.charCodeAt(0)
    )
    const form = new FormData()
    form.set("workspaceId", workspaceId)
    form.set("file", new File([bytes], data.fileName, { type: data.fileMime }))
    return readEngineJson<{
      ok: boolean
      mediaKey: string
      mediaMime: string
      mediaType: "image" | "video" | "audio" | "document"
    }>("/media/upload", workspaceId, { method: "POST", body: form })
  })

export const serverReact = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      msgId: string
      emoji: string
      fromMe?: boolean
      participant?: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/react`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          messageId: data.msgId,
          emoji: data.emoji,
          fromMe: data.fromMe,
          participant: data.participant,
        }),
      }
    )
  })

export const serverEditMessage = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      msgId: string
      newText: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/edit`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          messageId: data.msgId,
          text: data.newText,
        }),
      }
    )
  })

export const serverDeleteMessage = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      msgId: string
      forEveryone?: boolean
      fromMe?: boolean
      participant?: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/delete`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          messageId: data.msgId,
          forEveryone: data.forEveryone ?? false,
          fromMe: data.fromMe,
          participant: data.participant,
        }),
      }
    )
  })

export const serverChatModify = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      jid: string
      archive?: boolean
      pin?: boolean
      mute?: number | null
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/chat-modify`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jid: data.jid,
          archive: data.archive,
          pin: data.pin,
          mute: data.mute,
        }),
      }
    )
  })

export const serverForwardMessage = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      msgId: string
      from: string
      to: string
      text?: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/forward`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: data.msgId,
          fromJid: data.from,
          to: data.to,
          text: data.text,
        }),
      }
    )
  })

export const serverSendPoll = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      name: string
      values: string[]
      selectableCount?: number
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/poll`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          name: data.name,
          values: data.values,
          selectableCount: data.selectableCount,
        }),
      }
    )
  })

export const serverSendLocation = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      latitude: number
      longitude: number
      name?: string
      address?: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/location`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          latitude: data.latitude,
          longitude: data.longitude,
          name: data.name,
          address: data.address,
        }),
      }
    )
  })

export const serverSendContactCard = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      contacts: Array<{ displayName: string; vcard: string }>
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    // The engine's /contact-card sends one vCard message per call — loop
    // here so a multi-contact share still lands as one server function.
    let ok = true
    for (const contact of data.contacts) {
      const res = await readEngineJson<{ ok: boolean }>(
        `/session/${data.sessionId}/contact-card`,
        workspaceId,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: data.to,
            displayName: contact.displayName,
            vcard: contact.vcard,
          }),
        }
      )
      ok = ok && res.ok
    }
    return { ok }
  })

export const serverUpdatePresence = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      presence: "composing" | "recording" | "paused" | "available" | "unavailable"
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("view_inbox")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/presence`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid: data.to, presence: data.presence }),
      }
    )
  })

export const serverBlockUser = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string; jid: string; block: boolean }) => data)
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_contacts")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/block`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jid: data.jid,
          action: data.block ? "block" : "unblock",
        }),
      }
    )
  })

export const serverPinMessage = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      to: string
      msgId: string
      pin: boolean
      time?: number
      fromMe?: boolean
      participant?: string
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/pin`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.to,
          messageId: data.msgId,
          pin: data.pin,
          time: data.time,
          fromMe: data.fromMe,
          participant: data.participant,
        }),
      }
    )
  })

export const serverSetDisappearing = createServerFn({ method: "POST" })
  .validator(
    (data: { sessionId: string; to: string; duration: number }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/disappearing`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: data.to, duration: data.duration }),
      }
    )
  })

export const serverCreateGroup = createServerFn({ method: "POST" })
  .validator(
    (data: { sessionId: string; subject: string; participants: string[] }) =>
      data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_integrations")
    return readEngineJson<{ ok: boolean; id: string }>(
      `/session/${data.sessionId}/group-create`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: data.subject,
          participants: data.participants,
        }),
      }
    )
  })

export const serverUpdateGroupParticipants = createServerFn({
  method: "POST",
})
  .validator(
    (data: {
      sessionId: string
      groupJid: string
      participants: string[]
      action: "add" | "remove" | "promote" | "demote"
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_integrations")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/group-participants`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupJid: data.groupJid,
          participants: data.participants,
          action: data.action,
        }),
      }
    )
  })

export const serverUpdateGroupSettings = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      groupJid: string
      subject?: string
      description?: string
      setting?: "announcement" | "not_announcement" | "locked" | "unlocked"
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_integrations")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/group-settings`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupJid: data.groupJid,
          subject: data.subject,
          description: data.description,
          setting: data.setting,
        }),
      }
    )
  })

export const serverLeaveGroup = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string; groupJid: string }) => data)
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_integrations")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/group-leave`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupJid: data.groupJid }),
      }
    )
  })

export const serverGroupInviteLink = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string
      groupJid: string
      action: "get" | "revoke"
    }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("send_messages")
    return readEngineJson<{ ok: boolean; code: string; link: string }>(
      `/session/${data.sessionId}/group-invite`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupJid: data.groupJid,
          action: data.action,
        }),
      }
    )
  })

export const serverToggleGroupEphemeral = createServerFn({ method: "POST" })
  .validator(
    (data: { sessionId: string; groupJid: string; duration: number }) => data
  )
  .handler(async ({ data }) => {
    const workspaceId = await requireWorkspace("manage_integrations")
    return readEngineJson<{ ok: boolean }>(
      `/session/${data.sessionId}/group-ephemeral`,
      workspaceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupJid: data.groupJid,
          duration: data.duration,
        }),
      }
    )
  })

export async function proxyWorkspaceMedia(request: Request): Promise<Response> {
  const workspaceId = await requireWorkspace()
  const key = new URL(request.url).searchParams.get("key")
  if (!key) return new Response("Missing media key", { status: 400 })
  // Both Workers use the same dedicated KV namespace. KV does not support
  // R2's conditional-read API, so immutable media is served without 304 logic.
  if (!isWorkspaceMediaKey(workspaceId, key)) {
    return new Response("Forbidden", { status: 403 })
  }

  const media = await readMedia(env.MEDIA_KV, key)
  if (!media) return new Response("Media unavailable", { status: 404 })
  const headers = new Headers({ "Content-Type": media.mime })
  headers.set("Cache-Control", "private, max-age=31536000, immutable")
  applySafeMediaHeaders(headers)
  return new Response(media.bytes, { status: 200, headers })
}

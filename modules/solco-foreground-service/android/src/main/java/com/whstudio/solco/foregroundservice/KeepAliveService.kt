package com.whstudio.solco.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * The foreground service that holds the process — and with it the pinned Host sockets — for as long
 * as the phone is paired, foreground or background. Its ongoing notification doubles as the agent
 * status line ("Needs you: 2 · Working: 1 · Idle: 3"): the app pushes new text through
 * [SolcoForegroundServiceModule] and [post] re-posts it under the same id. Started and stopped by the
 * module; it owns no state beyond its notification text.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    intent?.getStringExtra(EXTRA_TITLE)?.let { title = it }
    intent?.getStringExtra(EXTRA_TEXT)?.let { text = it }
    startInForeground()
    running = true
    startPending = false
    // If the system reaps us there is nothing to rebuild: the next start rebuilds it from the app.
    // Swipe-kill ends delivery entirely, which is the documented free-path boundary.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun startInForeground() {
    val notification = build(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    /**
     * True from [android.content.Context.startForegroundService] until `startForeground` ran. Android
     * crashes the app (ForegroundServiceDidNotStartInTimeException) when the service is stopped
     * before that — so the module defers a stop while this is set.
     */
    @Volatile
    var startPending = false

    /** True while the service is in the foreground; [post] only touches a notification that exists. */
    @Volatile
    var running = false

    @Volatile
    var title = "Solco"

    @Volatile
    var text = "Staying connected to your Mac"

    // The silent MIN channel of the first version hid the line in the shade's fold; the status
    // needs the LOW tier (status-bar icon, no sound), and a channel's importance cannot be edited.
    const val CHANNEL_ID = "solco.keepalive.status"
    private const val LEGACY_CHANNEL_ID = "solco.keepalive"
    const val NOTIFICATION_ID = 24_256
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    /** Re-post the status line under the service's own id (no-op while the service is not running). */
    fun post(context: Context, newTitle: String, newText: String) {
      title = newTitle
      text = newText
      if (!running) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(NOTIFICATION_ID, build(context))
    }

    private fun build(context: Context): Notification {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.deleteNotificationChannel(LEGACY_CHANNEL_ID)
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Agent status", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shows how many agents need you, work and idle, and keeps the connection to your Mac alive."
            setShowBadge(false)
          },
        )
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      builder
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setCategory(Notification.CATEGORY_SERVICE)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
        builder.setContentIntent(
          PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
        )
      }
      return builder.build()
    }
  }
}

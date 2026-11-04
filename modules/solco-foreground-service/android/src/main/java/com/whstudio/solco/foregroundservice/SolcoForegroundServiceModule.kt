package com.whstudio.solco.foregroundservice

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo glue over [KeepAliveService]: start/stop/update the hold and its status line plus the
 * battery-optimization helpers the Connect screen's keep-alive card uses. A start issued from the
 * background throws on Android 12+; the JS seam swallows that — the hold is best effort by design.
 */
class SolcoForegroundServiceModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var deferredStop: Runnable? = null
  private var holdTaskId: Int? = null

  override fun definition() = ModuleDefinition {
    Name("SolcoForegroundService")

    Function("start") { title: String, text: String ->
      val context = appContext.reactContext
        ?: throw CodedException("ERR_NO_CONTEXT", "no Android context", null)
      cancelDeferredStop()
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(KeepAliveService.EXTRA_TITLE, title)
        .putExtra(KeepAliveService.EXTRA_TEXT, text)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        KeepAliveService.startPending = true
        try {
          context.startForegroundService(intent)
        } catch (error: Throwable) {
          KeepAliveService.startPending = false // refused (e.g. started from the background): nothing will run
          throw error
        }
      } else {
        context.startService(intent)
      }
      holdJsTimers()
    }

    // Re-posts the ongoing notification's text; safe from the background (a notify, not a service start).
    Function("update") { title: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      KeepAliveService.post(context, title, text)
      true
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function false
      releaseJsTimers()
      stopWhenForegrounded(context, System.currentTimeMillis())
      true
    }

    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext
        ?: throw CodedException("ERR_NO_CONTEXT", "no Android context", null)
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("openIgnoreBatteryOptimizations") {
      val context = appContext.reactContext
        ?: throw CodedException("ERR_NO_CONTEXT", "no Android context", null)
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  /**
   * React Native pauses every JS timer while the Activity is backgrounded unless a headless JS task is
   * running. TanStack Query notifies its observers through setTimeout, so without this an agent event
   * refetched the tree in the background but nothing downstream (the notification effect) ever ran.
   * The task (`SolcoKeepAlive`, never settles, no timeout) holds the timers for as long as the hold
   * runs; it takes no wake lock (unlike HeadlessJsTaskService), the Host's 5 s heartbeat is the wake-up.
   */
  private fun holdJsTimers() {
    handler.post {
      val react = appContext.reactContext as? ReactContext ?: return@post
      val tasks = HeadlessJsTaskContext.getInstance(react)
      val running = holdTaskId
      if (running != null && tasks.isTaskRunning(running)) return@post
      holdTaskId = try {
        tasks.startTask(HeadlessJsTaskConfig(HOLD_TASK, Arguments.createMap(), 0, true))
      } catch (error: Throwable) {
        null // no live JS instance yet: the next start() retries
      }
    }
  }

  private fun releaseJsTimers() {
    handler.post {
      val id = holdTaskId ?: return@post
      holdTaskId = null
      val react = appContext.reactContext as? ReactContext ?: return@post
      HeadlessJsTaskContext.getInstance(react).finishTask(id)
    }
  }

  private fun cancelDeferredStop() {
    deferredStop?.let(handler::removeCallbacks)
    deferredStop = null
  }

  /**
   * A stop that arrives before the service has called startForeground() crashes the app, so while a
   * start is pending the stop is retried every 100 ms (the service clears the flag within a few ms in
   * practice; 10 s is the system's own deadline, after which there is nothing left to protect).
   */
  private fun stopWhenForegrounded(context: Context, since: Long) {
    cancelDeferredStop()
    if (!KeepAliveService.startPending || System.currentTimeMillis() - since > STOP_WAIT_MS) {
      context.stopService(Intent(context, KeepAliveService::class.java))
      return
    }
    val retry = Runnable { stopWhenForegrounded(context, since) }
    deferredStop = retry
    handler.postDelayed(retry, STOP_RETRY_MS)
  }

  private companion object {
    const val STOP_RETRY_MS = 100L
    const val STOP_WAIT_MS = 10_000L
    const val HOLD_TASK = "SolcoKeepAlive"
  }
}

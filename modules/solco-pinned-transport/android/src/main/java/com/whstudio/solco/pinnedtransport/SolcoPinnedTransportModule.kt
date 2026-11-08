package com.whstudio.solco.pinnedtransport

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/**
 * Thin Expo glue over [PinnedClient]. Everything the JS side may do is here and nothing else:
 * pinned HTTPS requests and pinned WebSockets, identified by caller-chosen socket ids.
 */
class SolcoPinnedTransportModule : Module() {
  private val client = PinnedClient()
  private val sockets = ConcurrentHashMap<String, WebSocket>()

  override fun definition() = ModuleDefinition {
    Name("SolcoPinnedTransport")

    Events("onSocketEvent")

    AsyncFunction("request") Coroutine { url: String, method: String, headers: Map<String, String>, body: String?, fingerprint: String, timeoutMs: Int ->
      withContext(Dispatchers.IO) {
        try {
          val response = client.request(url, method, headers, body, fingerprint, timeoutMs)
          mapOf("status" to response.status, "headers" to response.headers, "body" to response.body)
        } catch (error: Throwable) {
          throw failure(error)
        }
      }
    }

    Function("openSocket") { id: String, url: String, protocols: List<String>, fingerprint: String ->
      require(!sockets.containsKey(id)) { "socket id already in use" }
      val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) = emit(id, "open")
        override fun onMessage(webSocket: WebSocket, text: String) = emit(id, "text", "data" to text)
        override fun onMessage(webSocket: WebSocket, bytes: ByteString) =
          emit(id, "binary", "data" to Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, null)
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          sockets.remove(id)
          emit(id, "closed", "code" to code, "reason" to reason)
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          sockets.remove(id)
          emit(
            id, "failed",
            "message" to (t.message ?: t.javaClass.simpleName),
            "pinMismatch" to PinnedClient.isPinMismatch(t),
            "status" to (response?.code ?: 0),
          )
        }
      }
      try {
        sockets[id] = client.openSocket(url, protocols, fingerprint, listener)
      } catch (error: Throwable) {
        throw failure(error)
      }
    }

    Function("sendText") { id: String, text: String ->
      socket(id).send(text)
    }

    Function("sendBinary") { id: String, base64: String ->
      socket(id).send(Base64.decode(base64, Base64.DEFAULT).toByteString())
    }

    Function("closeSocket") { id: String, code: Int, reason: String ->
      sockets[id]?.close(code, reason)
    }

    OnDestroy {
      sockets.values.forEach { it.cancel() }
      sockets.clear()
    }
  }

  private fun socket(id: String): WebSocket =
    sockets[id] ?: throw CodedException("ERR_SOCKET_CLOSED", "socket $id is not open", null)

  private fun emit(id: String, type: String, vararg fields: Pair<String, Any>) {
    sendEvent("onSocketEvent", mapOf("id" to id, "type" to type) + fields)
  }

  private fun failure(error: Throwable): CodedException = when {
    PinnedClient.isPinMismatch(error) -> CodedException("ERR_PIN_MISMATCH", "the Host's certificate is not the one that was paired", error)
    error is IllegalArgumentException -> CodedException("ERR_INVALID_ARGUMENT", error.message, error)
    else -> CodedException("ERR_TRANSPORT", error.message ?: error.javaClass.simpleName, error)
  }
}

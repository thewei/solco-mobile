package com.whstudio.solco.tailcat

import android.util.Base64
import com.whstudio.solco.tailcat.tailcatbridge.Client
import com.whstudio.solco.tailcat.tailcatbridge.Socket
import com.whstudio.solco.tailcat.tailcatbridge.SocketListener
import com.whstudio.solco.tailcat.tailcatbridge.Tailcatbridge
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

/**
 * Thin Expo glue over the gomobile Tailcat bridge (mobilebridge/tailcatbridge). Everything the JS
 * side may do is here and nothing else: one tunnel client per caller-chosen handle, its pinned
 * HTTPS requests, and pinned WebSockets identified by caller-chosen socket ids. No address, node
 * key, token or tunnel capability is ever logged.
 */
class SolcoTailcatTransportModule : Module() {
  private val clients = ConcurrentHashMap<String, Client>()
  private val sockets = ConcurrentHashMap<String, Socket>()
  private var network: NetworkStateReporter? = null

  override fun definition() = ModuleDefinition {
    Name("SolcoTailcatTransport")

    Events("onSocketEvent")

    OnCreate {
      network = appContext.reactContext?.let { NetworkStateReporter(it).also { reporter -> reporter.start() } }
    }

    AsyncFunction("generateNodeKey") { Tailcatbridge.generateNodeKey() }

    AsyncFunction("clientNew") Coroutine { handle: String, tc: String, nodeKey: String, pinHex: String ->
      network?.push()
      val pub = Tailcatbridge.publicKeyOf(nodeKey)
      require(pub.startsWith("nodekey:")) { "invalid node key" }
      // A rebuilt client (network change) replaces the old one under the same handle; the old one and the
      // sockets it carried are closed so nothing keeps a path of the previous network.
      clients.put(handle, Tailcatbridge.newClient(tc, nodeKey, pinHex))?.close()
      null
    }
    AsyncFunction("clientRequest") Coroutine { handle: String, method: String, path: String, headersJson: String, bodyB64: String?, timeoutMs: Long ->
      val body = if (bodyB64 == null) ByteArray(0) else Base64.decode(bodyB64, Base64.DEFAULT)
      val response = client(handle).request(method, path, headersJson, body, timeoutMs)
      mapOf("status" to response.status(), "body" to String(response.body(), Charsets.UTF_8))
    }

    Function("publicKeyOf") { nodeKey: String ->
      Tailcatbridge.publicKeyOf(nodeKey)
    }

    Function("openSocket") { handle: String, id: String, path: String, protocolsCsv: String ->
      require(!sockets.containsKey(id)) { "socket id already in use" }
      val listener = object : SocketListener {
        override fun onOpen() = emit(id, "open")
        override fun onText(text: String?) = emit(id, "text", "data" to (text ?: ""))
        override fun onBinary(data: ByteArray?) =
          emit(id, "binary", "data" to Base64.encodeToString(data ?: ByteArray(0), Base64.DEFAULT))
        override fun onClose(code: Long, reason: String?) {
          sockets.remove(id)
          emit(id, "close", "code" to code.toInt(), "reason" to (reason ?: ""))
        }
        override fun onError(message: String?, pinMismatch: Boolean, httpStatus: Long) {
          sockets.remove(id)
          emit(id, "error", "message" to (message ?: ""), "pinMismatch" to pinMismatch, "httpStatus" to httpStatus)
        }
      }
      try {
        sockets[id] = client(handle).openSocket(path, protocolsCsv, listener)
      } catch (error: Throwable) {
        throw failure(error)
      }
    }

    Function("socketSendText") { id: String, text: String ->
      socket(id).sendText(text)
    }

    Function("socketSendBinary") { id: String, base64: String ->
      socket(id).sendBinary(Base64.decode(base64, Base64.DEFAULT))
    }

    Function("socketClose") { id: String, code: Long, reason: String ->
      sockets[id]?.close(code, reason)
    }

    Function("clientClose") { handle: String ->
      sockets.clear()
      clients.remove(handle)?.close()
    }

    OnDestroy {
      network?.stop()
      sockets.values.forEach { it.close(1001, "module destroyed") }
      sockets.clear()
      clients.values.forEach { it.close() }
      clients.clear()
    }
  }

  private fun client(handle: String): Client =
    clients[handle] ?: throw CodedException("ERR_NO_CLIENT", "tunnel client $handle is not open", null)

  private fun socket(id: String): Socket =
    sockets[id] ?: throw CodedException("ERR_SOCKET_CLOSED", "socket $id is not open", null)

  private fun emit(id: String, type: String, vararg fields: Pair<String, Any>) {
    sendEvent("onSocketEvent", mapOf("id" to id, "type" to type) + fields)
  }

  private fun failure(error: Throwable): CodedException = when {
    error.message?.contains("pin_mismatch") == true ->
      CodedException("ERR_PIN_MISMATCH", "the Mac's identity changed", error)
    else -> CodedException("ERR_TAILCAT_FAILED", error.message ?: "the tunnel request failed", error)
  }
}

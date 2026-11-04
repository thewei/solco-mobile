package com.whstudio.solco.pinnedtransport

import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** The presented certificate is not the one the pairing link named. */
class PinMismatchException(message: String) : CertificateException(message)

/**
 * The only trust root: the leaf certificate's DER SHA-256 must equal the pinned value.
 * No chain building, no system roots, no hostname check — the Host's certificate is
 * self-signed and often addressed by IP, so the pin is the identity.
 */
class PinnedTrustManager(expectedHex: String) : X509TrustManager {
  private val expected: ByteArray = Fingerprint.decode(expectedHex)

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf = chain?.firstOrNull() ?: throw PinMismatchException("empty certificate chain")
    if (!MessageDigest.isEqual(Fingerprint.sha256(leaf.encoded), expected)) {
      throw PinMismatchException("certificate fingerprint mismatch")
    }
  }

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    throw CertificateException("client certificates are not supported")
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

object Fingerprint {
  private val HEX = Regex("^[0-9a-fA-F]{64}$")

  fun decode(hex: String): ByteArray {
    require(HEX.matches(hex)) { "fingerprint must be 64 hex characters" }
    return ByteArray(32) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  }

  fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
}

class PinnedClient(private val base: OkHttpClient = OkHttpClient()) {
  data class Response(val status: Int, val headers: Map<String, String>, val body: String)

  /** One pinned HTTPS call. Redirects are never followed: a redirect would carry the token elsewhere. */
  fun request(
    url: String,
    method: String,
    headers: Map<String, String>,
    body: String?,
    fingerprint: String,
    timeoutMs: Int,
  ): Response {
    require(url.startsWith("https://")) { "only https:// is allowed" }
    val verb = method.uppercase()
    require(verb in METHODS) { "unsupported method $method" }
    val builder = Request.Builder().url(url)
    var contentType: String? = null
    for ((name, value) in headers) {
      if (name.equals("content-type", ignoreCase = true)) contentType = value else builder.header(name, value)
    }
    val payload = when {
      verb == "GET" || (verb == "DELETE" && body == null) -> null
      else -> (body ?: "").toRequestBody(contentType?.toMediaTypeOrNull())
    }
    builder.method(verb, payload)
    // callTimeout alone is not enough: OkHttp's 10 s default readTimeout still cuts a slow answer (a launch
    // waits for the agent) while the Host carries on, so the budget is applied to the read as well.
    val budget = timeoutMs.coerceIn(1_000, MAX_REQUEST_MS).toLong()
    val http = client(fingerprint)
      .newBuilder()
      .callTimeout(budget, TimeUnit.MILLISECONDS)
      .readTimeout(budget, TimeUnit.MILLISECONDS)
      .build()
    http.newCall(builder.build()).execute().use { response ->
      val source = response.body!!.source()
      source.request(MAX_BODY_BYTES + 1)
      if (source.buffer.size > MAX_BODY_BYTES) throw IOException("response larger than $MAX_BODY_BYTES bytes")
      val text = source.readUtf8()
      val out = LinkedHashMap<String, String>()
      for (name in response.headers.names()) out[name.lowercase()] = response.headers.values(name).joinToString(", ")
      return Response(response.code, out, text)
    }
  }

  /** A pinned `wss://` socket; the subprotocol list carries the bearer pair. */
  fun openSocket(url: String, protocols: List<String>, fingerprint: String, listener: WebSocketListener): WebSocket {
    require(url.startsWith("wss://")) { "only wss:// is allowed" }
    val builder = Request.Builder().url(url)
    if (protocols.isNotEmpty()) builder.header("Sec-WebSocket-Protocol", protocols.joinToString(", "))
    val http = client(fingerprint)
      .newBuilder()
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .pingInterval(25, TimeUnit.SECONDS)
      .build()
    return http.newWebSocket(builder.build(), listener)
  }

  private fun client(fingerprint: String): OkHttpClient {
    val trust = PinnedTrustManager(fingerprint)
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(trust), SecureRandom())
    return base.newBuilder()
      .sslSocketFactory(context.socketFactory, trust)
      .hostnameVerifier { _, _ -> true } // the pin replaces the name check
      .followRedirects(false)
      .followSslRedirects(false)
      .build()
  }

  companion object {
    const val MAX_BODY_BYTES = 4L * 1024 * 1024
    /** Above the Host's own 150 s launch budget, so the Host's verdict is what the user reads. */
    const val MAX_REQUEST_MS = 170_000
    private val METHODS = setOf("GET", "POST", "PUT", "PATCH", "DELETE")

    /** True when the failure is the pin refusing the certificate, however OkHttp wrapped it. */
    fun isPinMismatch(error: Throwable?): Boolean {
      var cause = error
      var depth = 0
      while (cause != null && depth++ < 8) {
        if (cause is PinMismatchException) return true
        cause = cause.cause
      }
      return false
    }
  }
}

package com.whstudio.solco.pinnedtransport

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.ByteString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class PinnedClientTest {
  private lateinit var server: MockWebServer
  private lateinit var pin: String
  private val client = PinnedClient()

  // The Host's certificate is addressed by IP and is in no trust store: serve one for
  // "localhost" and reach it as 127.0.0.1 to prove neither the name nor the roots matter.
  private fun url(path: String, scheme: String = "https") = "$scheme://127.0.0.1:${server.port}$path"

  private fun hex(cert: HeldCertificate) =
    Fingerprint.sha256(cert.certificate.encoded).joinToString("") { "%02x".format(it) }

  @Before
  fun start() {
    val held = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
    pin = hex(held)
    val certs = HandshakeCertificates.Builder().heldCertificate(held).build()
    server = MockWebServer()
    server.useHttps(certs.sslSocketFactory(), false)
    server.start()
  }

  @After
  fun stop() = server.shutdown()

  @Test
  fun requestsWithTheRightPin() {
    server.enqueue(MockResponse().setBody("""{"ok":true}""").addHeader("X-Test", "1"))
    val response = client.request(url("/api/v3/bootstrap"), "GET", mapOf("Authorization" to "Bearer t"), null, pin, 5_000)
    assertEquals(200, response.status)
    assertEquals("""{"ok":true}""", response.body)
    assertEquals("1", response.headers["x-test"])
    assertEquals("Bearer t", server.takeRequest().getHeader("Authorization"))
  }

  @Test
  fun acceptsUppercasePin() {
    server.enqueue(MockResponse().setBody("x"))
    assertEquals(200, client.request(url("/"), "GET", emptyMap(), null, pin.uppercase(), 5_000).status)
  }

  @Test
  fun aSlowAnswerWaitsForTheCallersBudgetNotTheClientReadDefault() {
    // A launch answers only when the agent is up; the base client's own read timeout must not cut it short.
    val impatient = PinnedClient(okhttp3.OkHttpClient.Builder().readTimeout(300, TimeUnit.MILLISECONDS).build())
    server.enqueue(MockResponse().setBody("late").setHeadersDelay(1_200, TimeUnit.MILLISECONDS))
    val response = impatient.request(url("/"), "POST", mapOf("content-type" to "application/json"), "{}", pin, 5_000)
    assertEquals("late", response.body)
  }

  @Test
  fun refusesAnotherCertificateBeforeAnyRequestBytesAreSent() {
    server.enqueue(MockResponse().setBody("secret"))
    try {
      client.request(url("/"), "GET", mapOf("Authorization" to "Bearer t"), null, "0".repeat(64), 5_000)
      fail("a wrong pin must fail")
    } catch (error: Exception) {
      assertTrue(error.toString(), PinnedClient.isPinMismatch(error))
    }
    assertEquals("the server must never see the request", 0, server.requestCount)
  }

  @Test
  fun postsJsonBodies() {
    server.enqueue(MockResponse().setBody("{}"))
    client.request(url("/api/v3/pair"), "POST", mapOf("content-type" to "application/json"), """{"code":"A"}""", pin, 5_000)
    val recorded = server.takeRequest()
    assertEquals("POST", recorded.method)
    assertEquals("""{"code":"A"}""", recorded.body.readUtf8())
    assertTrue(recorded.getHeader("Content-Type")!!.startsWith("application/json"))
  }

  @Test
  fun neverFollowsRedirects() {
    server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "https://evil.example/"))
    val response = client.request(url("/"), "GET", mapOf("Authorization" to "Bearer t"), null, pin, 5_000)
    assertEquals(302, response.status)
    assertEquals(1, server.requestCount)
  }

  @Test
  fun refusesPlainHttpAndOddInput() {
    val bad = listOf(
      { client.request("http://127.0.0.1:${server.port}/", "GET", emptyMap(), null, pin, 5_000) },
      { client.request(url("/"), "TRACE", emptyMap(), null, pin, 5_000) },
      { client.request(url("/"), "GET", emptyMap(), null, "abc", 5_000) },
    )
    for (call in bad) {
      try {
        call()
        fail("must be refused")
      } catch (_: IllegalArgumentException) {
      }
    }
    assertEquals(0, server.requestCount)
  }

  @Test
  fun boundsTheResponseBody() {
    server.enqueue(MockResponse().setBody("x".repeat((PinnedClient.MAX_BODY_BYTES + 10).toInt())))
    try {
      client.request(url("/"), "GET", emptyMap(), null, pin, 30_000)
      fail("an oversized body must be refused")
    } catch (error: java.io.IOException) {
      assertTrue(error.message!!.contains("larger"))
    }
  }

  private class Recorder : WebSocketListener() {
    val opened = CountDownLatch(1)
    val received = CountDownLatch(2)
    val closed = CountDownLatch(1)
    val failure = AtomicReference<Throwable?>()
    val text = AtomicReference<String?>()
    val bytes = AtomicReference<ByteString?>()
    override fun onOpen(webSocket: WebSocket, response: Response) = opened.countDown()
    override fun onMessage(webSocket: WebSocket, text: String) { this.text.set(text); received.countDown() }
    override fun onMessage(webSocket: WebSocket, bytes: ByteString) { this.bytes.set(bytes); received.countDown() }
    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = closed.countDown()
    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
      failure.set(t)
      closed.countDown()
    }
  }

  @Test
  fun socketCarriesSubprotocolsAndFrames() {
    server.enqueue(
      MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
          webSocket.send("echo:$text")
          webSocket.send(ByteString.of(1, 2, 3))
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, null)
        }
      }),
    )
    val recorder = Recorder()
    val socket = client.openSocket(url("/api/v3/events", "wss"), listOf("solco.bearer", "tok"), pin, recorder)
    assertTrue(recorder.opened.await(5, TimeUnit.SECONDS))
    socket.send("hi")
    assertTrue(recorder.received.await(5, TimeUnit.SECONDS))
    socket.close(1000, "bye")
    assertTrue(recorder.closed.await(5, TimeUnit.SECONDS))
    assertEquals("echo:hi", recorder.text.get())
    assertEquals(ByteString.of(1, 2, 3), recorder.bytes.get())
    assertEquals("solco.bearer, tok", server.takeRequest().getHeader("Sec-WebSocket-Protocol"))
  }

  @Test
  fun socketWithTheWrongPinFailsAsAMismatch() {
    server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {}))
    val recorder = Recorder()
    client.openSocket(url("/api/v3/events", "wss"), listOf("solco.bearer", "tok"), "f".repeat(64), recorder)
    assertTrue(recorder.closed.await(5, TimeUnit.SECONDS))
    val failure = recorder.failure.get()
    assertNotNull("the socket must fail, not open", failure)
    assertTrue(failure.toString(), PinnedClient.isPinMismatch(failure))
    assertEquals("never opened", 1L, recorder.opened.count)
    assertEquals(0, server.requestCount)
  }
}

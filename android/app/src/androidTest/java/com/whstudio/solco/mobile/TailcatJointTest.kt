package com.whstudio.solco.mobile

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.whstudio.solco.tailcat.tailcatbridge.Tailcatbridge
import java.net.NetworkInterface
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The real-device joint test for the embedded Tailcat transport (G0/P0 in
 * docs/tailcat-embedded-transport-implementation-plan): the AAR runs inside the actual app
 * process on the phone, feeds netmon a snapshot from the OS (the netlinkrib trap this exists
 * to avoid), pairs over the tunnel with a one-time code exactly as the app will, and reads
 * the Host's bootstrap through the pinned connection.
 *
 * Run against a Mac serving the Host with `-tailcat` (cmd/rd-devhost prints the pairing link):
 * ./gradlew :app:connectedDebugAndroidTest
 *   -Pandroid.testInstrumentationRunnerArguments.tcAddr=<tc param>
 *   -Pandroid.testInstrumentationRunnerArguments.pairCode=<c param>
 *   -Pandroid.testInstrumentationRunnerArguments.fp=<fp param>
 */
@RunWith(AndroidJUnit4::class)
class TailcatJointTest {

    private fun networkSnapshot(): String {
        val ifs = JSONArray()
        var defaultName = ""
        for (nif in NetworkInterface.getNetworkInterfaces()) {
            val addrs = JSONArray()
            for (a in nif.interfaceAddresses) {
                a.address?.hostAddress?.let { if (!it.contains('%')) addrs.put("$it/${a.networkPrefixLength}") }
            }
            val o = JSONObject()
                .put("name", nif.name)
                .put("index", nif.index)
                .put("mtu", nif.mtu)
                .put("up", nif.isUp)
                .put("loopback", nif.isLoopback)
                .put("addrs", addrs)
            ifs.put(o)
            if (nif.isUp && !nif.isLoopback && defaultName == "" && nif.inetAddresses.iterator().hasNext()) defaultName = nif.name
        }
        return JSONObject()
            .put("interfaces", ifs)
            .put("defaultInterface", defaultName)
            .put("gateway", "")
            .toString()
    }

    @Test
    fun pairsOverTheTunnelAndReadsBootstrap() {
        val args = InstrumentationRegistry.getArguments()
        val tcAddr = args.getString("tcAddr") ?: throw AssertionError("pass -Pandroid.testInstrumentationRunnerArguments.tcAddr=<tc>")
        val pairCode = args.getString("pairCode") ?: throw AssertionError("pass -Pandroid.testInstrumentationRunnerArguments.pairCode=<c>")
        val fp = args.getString("fp") ?: throw AssertionError("pass -Pandroid.testInstrumentationRunnerArguments.fp=<fp>")
        val deviceName = args.getString("deviceName") ?: android.os.Build.MODEL

        // netmon on a Go-mobile process must not touch netlink (the Android permission trap);
        // the app feeds the snapshot from the OS instead.
        Tailcatbridge.setNetworkState(networkSnapshot())

        val nodeKey = Tailcatbridge.generateNodeKey()
        val pub = Tailcatbridge.publicKeyOf(nodeKey)
        assertTrue("public key shape", pub.startsWith("nodekey:"))

        val client = Tailcatbridge.newClient(tcAddr, nodeKey, fp)

        val pairBody = JSONObject()
            .put("code", pairCode)
            .put("deviceName", deviceName)
            .put("clientKey", pub)
            .toString().toByteArray()
        val pair = client.request("POST", "/api/v3/pair", """{"Content-Type":"application/json"}""", pairBody, 30000)
        assertTrue("pair status ${pair.status()}", pair.status() == 200L)
        val token = JSONObject(String(pair.body())).getString("token")
        assertTrue("token issued", token.isNotEmpty())

        val boot = client.request("GET", "/api/v3/bootstrap", """{"Authorization":"Bearer $token"}""", ByteArray(0), 30000)
        assertTrue("bootstrap status ${boot.status()}", boot.status() == 200L)
        val hostId = JSONObject(String(boot.body())).getString("hostId")
        assertTrue("bootstrap carries a hostId", hostId.isNotEmpty())

        val rtt = client.ping(15000)
        assertTrue("ping rtt sane: $rtt", rtt >= 0)

        Log.i("TailcatJoint", "PASS rtt=${rtt}ms hostId=$hostId")
    }
}

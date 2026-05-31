package com.teacher.monitor

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.core.view.WindowCompat
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale

// Global state for dynamic IP management
var CURRENT_IP by mutableStateOf("192.168.0.7")
var IS_CONNECTED by mutableStateOf(false)
fun getUrl() = "http://$CURRENT_IP:8080"

// Notification ID
const val CHANNEL_ID = "attendance_alerts"

// Premium Dark Tech Colors
val BgDeep = Color(0xFF080C14)
val BgCard = Color(0xFF121826)
val AccentLime = Color(0xFFC0FF00)
val TextWhite = Color(0xFFFFFFFF)
val TextGray = Color(0xFF94A3B8)
val DangerRed = Color(0xFFFF3366)

fun Modifier.glassMorphic(shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(16.dp)) = this
    .clip(shape)
    .background(BgCard)
    .border(1.dp, Color.White.copy(alpha = 0.05f), shape)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        createNotificationChannel()
        
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = AccentLime,
                    secondary = AccentLime,
                    background = Color.Transparent,
                    surface = Color.Transparent,
                    onSurface = TextWhite
                )
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(BgDeep)
                ) {
                    if (!IS_CONNECTED) {
                        ConnectionScreen()
                    } else {
                        TeacherDashboard(this@MainActivity)
                    }
                }
            }
        }
    }

    private fun createNotificationChannel() {
        val name = "Attendance Alerts"
        val descriptionText = "Notifications for new student detections"
        val importance = NotificationManager.IMPORTANCE_DEFAULT
        val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
            description = descriptionText
        }
        val notificationManager: NotificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.createNotificationChannel(channel)
    }
}

@Composable
fun ConnectionScreen() {
    var ipInput by remember { mutableStateOf(CURRENT_IP) }
    var isTesting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(Icons.Default.CloudSync, "Connect", modifier = Modifier.size(80.dp), tint = AccentLime)
        Spacer(modifier = Modifier.height(24.dp))
        Text("Connect to Aura Core", fontSize = 28.sp, fontWeight = FontWeight.Black, color = TextWhite)
        Spacer(modifier = Modifier.height(8.dp))
        Text("Enter your PC's local Wi-Fi IP address.", color = TextGray, fontSize = 14.sp)
        
        Spacer(modifier = Modifier.height(32.dp))
        
        OutlinedTextField(
            value = ipInput,
            onValueChange = { ipInput = it },
            label = { Text("IP Address (e.g., 192.168.1.5)", color = TextGray) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = TextWhite,
                unfocusedTextColor = TextWhite,
                focusedBorderColor = AccentLime,
                unfocusedBorderColor = TextGray
            )
        )
        
        if (errorMessage.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(errorMessage, color = Color.Red, fontSize = 12.sp)
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = {
                if (ipInput.isBlank()) {
                    errorMessage = "IP cannot be blank"
                    return@Button
                }
                isTesting = true
                errorMessage = ""
                scope.launch(Dispatchers.IO) {
                    try {
                        val cleanIp = ipInput.trim()
                            .replace("http://", "")
                            .replace("https://", "")
                            .removeSuffix("/")
                        val url = URL("http://$cleanIp:8080/api/realtime/dashboard")
                        val connection = url.openConnection() as HttpURLConnection
                        connection.connectTimeout = 3000
                        if (connection.responseCode == 200) {
                            withContext(Dispatchers.Main) {
                                CURRENT_IP = ipInput
                                IS_CONNECTED = true
                            }
                        } else {
                            withContext(Dispatchers.Main) {
                                errorMessage = "Server responded with error ${connection.responseCode}"
                                isTesting = false
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            errorMessage = "Failed to connect. Check IP and ensure PC is running."
                            isTesting = false
                        }
                    }
                }
            },
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = RoundedCornerShape(28.dp),
            colors = ButtonDefaults.buttonColors(containerColor = AccentLime)
        ) {
            if (isTesting) {
                CircularProgressIndicator(color = BgDeep, modifier = Modifier.size(24.dp))
            } else {
                Text("Connect", color = BgDeep, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

fun showNotification(context: Context, title: String, message: String) {
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setContentText(message)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setAutoCancel(true)

    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.notify(System.currentTimeMillis().toInt(), builder.build())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeacherDashboard(context: Context) {
    var selectedTab by remember { mutableIntStateOf(0) }
    var showSettings by remember { mutableStateOf(false) }
    var lastPresentCount by remember { mutableIntStateOf(-1) }

    // Smart Notification Polling
    LaunchedEffect(CURRENT_IP) {
        while (true) {
            try {
                val url = URL("${getUrl()}/api/realtime/dashboard")
                val connection = url.openConnection() as HttpURLConnection
                connection.connectTimeout = 2000
                if (connection.responseCode == 200) {
                    val response = connection.inputStream.bufferedReader().use { it.readText() }
                    val json = JSONObject(response)
                    val currentPresent = json.getInt("present_today")
                    
                    if (lastPresentCount != -1 && currentPresent > lastPresentCount) {
                        val names = json.getJSONArray("present_names")
                        if (names.length() > 0) {
                            val newStudent = names.getString(0)
                            showNotification(context, "New Detection! ✨", "$newStudent just entered the classroom.")
                        }
                    }
                    lastPresentCount = currentPresent
                }
            } catch (e: Exception) { }
            delay(5000)
        }
    }

    if (showSettings) {
        AlertDialog(
            onDismissRequest = { showSettings = false },
            confirmButton = {
                TextButton(onClick = { showSettings = false }) { Text("Done", color = AccentLime) }
            },
            title = { Text("Server Settings", color = TextWhite, fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text("Enter Backend IP Address:", fontSize = 14.sp, color = TextGray)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = CURRENT_IP,
                        onValueChange = { CURRENT_IP = it },
                        placeholder = { Text("e.g. 192.168.1.10", color = TextGray) },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextWhite,
                            unfocusedTextColor = TextWhite,
                            focusedBorderColor = AccentLime,
                            unfocusedBorderColor = TextGray
                        )
                    )
                }
            },
            shape = RoundedCornerShape(20.dp),
            containerColor = BgCard
        )
    }

    Scaffold(
        modifier = Modifier.systemBarsPadding(),
        containerColor = Color.Transparent,
        topBar = {
            if (selectedTab != 2) {
                TopAppBar(
                    title = { 
                        Column {
                            Text("Hello, Teacher!", fontWeight = FontWeight.Bold, fontSize = 26.sp, color = TextWhite)
                            Text("Aura Intelligence Hub \u25BE", fontSize = 14.sp, color = AccentLime)
                        }
                    },
                    actions = {
                        IconButton(onClick = { showSettings = true }) {
                            Box(modifier = Modifier.size(48.dp).glassMorphic(CircleShape), contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.Settings, "Settings", tint = AccentLime)
                            }
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Box(modifier = Modifier.padding(end = 16.dp).size(48.dp).glassMorphic(CircleShape), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.NotificationsNone, "Alerts", tint = AccentLime)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
                )
            }
        },
        bottomBar = {
            if (selectedTab != 2) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 24.dp, start = 32.dp, end = 32.dp)
                        .height(72.dp)
                        .glassMorphic(RoundedCornerShape(36.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        NavItem(icon = Icons.Default.CameraAlt, label = "Live", isSelected = selectedTab == 0) { selectedTab = 0 }
                        NavItem(icon = Icons.Default.Groups, label = "Roster", isSelected = selectedTab == 1) { selectedTab = 1 }
                        NavItem(icon = Icons.Default.AutoAwesome, label = "AI", isSelected = selectedTab == 2) { selectedTab = 2 }
                    }
                }
            }
        }
    ) { paddingValues ->
        Box(modifier = Modifier.padding(paddingValues).fillMaxSize()) {
            when (selectedTab) {
                0 -> LiveCameraFeedScreen()
                1 -> AttendanceScreen()
                2 -> AiAssistantScreen(onBack = { selectedTab = 0 })
            }
        }
    }
}

@Composable
fun NavItem(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, isSelected: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (isSelected) AccentLime else Color.Transparent,
            contentColor = if (isSelected) BgDeep else TextGray
        ),
        shape = RoundedCornerShape(24.dp),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(24.dp))
            if (isSelected) {
                Spacer(modifier = Modifier.width(8.dp))
                Text(label, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun LiveCameraFeedScreen() {
    var stats by remember { mutableStateOf<JSONObject?>(null) }

    var isOnline by remember { mutableStateOf(true) }

    var lastErrorCode by remember { mutableStateOf<String?>(null) }

    val client = remember { okhttp3.OkHttpClient() }

    LaunchedEffect(CURRENT_IP) {
        while(true) {
            try {
                val request = okhttp3.Request.Builder()
                    .url("http://${CURRENT_IP}:8080/api/realtime/dashboard")
                    .build()
                
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            val body = response.body?.string() ?: "{}"
                            stats = JSONObject(body)
                            lastErrorCode = null
                        } else {
                            lastErrorCode = "Code ${response.code}"
                            stats = null
                        }
                    }
                }
            } catch (e: Exception) { 
                lastErrorCode = e.javaClass.simpleName + ": " + e.message
                stats = null
            }
            delay(3000)
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp).verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.Start) {
            Text("OPTICAL FEED", fontSize = 14.sp, fontWeight = FontWeight.Black, color = AccentLime, letterSpacing = 2.sp)
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f/9f)
                .shadow(16.dp, RoundedCornerShape(24.dp), spotColor = Color(0x66000000))
                .clip(RoundedCornerShape(24.dp))
                .background(Color.Black),
            contentAlignment = Alignment.Center
        ) {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        settings.javaScriptEnabled = true
                        settings.loadWithOverviewMode = true
                        settings.useWideViewPort = true
                        settings.domStorageEnabled = true
                        webViewClient = android.webkit.WebViewClient()
                        setBackgroundColor(android.graphics.Color.BLACK)
                        // Load the feed directly to avoid HTML issues
                        loadUrl("http://${CURRENT_IP}:8080/video_feed")
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
            Row(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(20.dp)
                    .glassMorphic(RoundedCornerShape(20.dp))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("LIVE", color = AccentLime, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(AccentLime))
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Today's Date + Auto-refresh indicator
        val todayDate = SimpleDateFormat("EEEE, dd MMM yyyy", Locale.getDefault()).format(java.util.Date())
        val totalStudents = stats?.optInt("total_students", 0) ?: 0
        val presentCount = stats?.optInt("present_today", 0) ?: 0
        val absentCount = stats?.optInt("absent_today", 0) ?: 0

        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(todayDate, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = TextWhite)
                Text("$totalStudents ENROLLED", fontSize = 12.sp, color = TextGray)
            }
            Row(
                modifier = Modifier
                    .glassMorphic(RoundedCornerShape(12.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(if(stats != null) AccentLime else DangerRed))
                Spacer(modifier = Modifier.width(6.dp))
                Text(if(stats != null) "ONLINE" else "LINKING... (${lastErrorCode ?: "..."})", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if(stats != null) AccentLime else DangerRed)
            }
        }
        
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard(
                title = "VERIFIED", 
                value = "$presentCount",
                subtitle = "of $totalStudents",
                icon = Icons.Default.CheckCircle, 
                color = AccentLime,
                modifier = Modifier.weight(1f)
            )
            StatCard(
                title = "UNVERIFIED", 
                value = "$absentCount",
                subtitle = "of $totalStudents",
                icon = Icons.Default.Cancel, 
                color = DangerRed,
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(modifier = Modifier.height(20.dp))
        
        val scrollState = rememberScrollState()
        LaunchedEffect(Unit) {
            while (true) {
                scrollState.animateScrollTo(scrollState.maxValue, animationSpec = tween(20000, easing = LinearEasing))
                scrollState.scrollTo(0)
            }
        }
        
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .glassMorphic(RoundedCornerShape(12.dp))
                .padding(vertical = 12.dp)
                .horizontalScroll(scrollState),
            horizontalArrangement = Arrangement.Center
        ) {
            Text(
                "✦ PSNA AURA INTELLIGENCE ✦ LIVE CLASSROOM ✦ AI MONITORING ✦ AUTO ATTENDANCE ✦ ".repeat(5),
                fontWeight = FontWeight.Bold, 
                color = AccentLime.copy(alpha = 0.4f), 
                letterSpacing = 2.sp
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(modifier = Modifier.weight(1f).glassMorphic(RoundedCornerShape(20.dp)).padding(16.dp)) {
                Column {
                    Icon(Icons.Default.Speed, "Speed", tint = AccentLime)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Ultra-Low Latency", color = TextGray, fontSize = 12.sp)
                    Text("30 FPS Active", fontWeight = FontWeight.Bold, color = TextWhite)
                }
            }
            Box(modifier = Modifier.weight(1f).glassMorphic(RoundedCornerShape(20.dp)).padding(16.dp)) {
                Column {
                    Icon(Icons.Default.CloudSync, "Sync", tint = AccentLime)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Database Sync", color = TextGray, fontSize = 12.sp)
                    Text("Connected", fontWeight = FontWeight.Bold, color = TextWhite)
                }
            }
        }
        Spacer(modifier = Modifier.height(100.dp))
    }
}

@Composable
fun StatCard(title: String, value: String, subtitle: String = "", icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, modifier: Modifier) {
    Box(
        modifier = modifier
            .glassMorphic(RoundedCornerShape(24.dp))
            .padding(16.dp)
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(32.dp).clip(CircleShape).background(color.copy(alpha = 0.1f)), contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = title, tint = color, modifier = Modifier.size(18.dp))
                }
                Spacer(modifier = Modifier.width(8.dp))
                Text(title, color = TextGray, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(modifier = Modifier.height(12.dp))
            Text(value, fontSize = 36.sp, fontWeight = FontWeight.Bold, color = color)
            if (subtitle.isNotEmpty()) {
                Text(subtitle, fontSize = 13.sp, color = TextGray, fontWeight = FontWeight.Medium)
            }
        }
    }
}

data class AttendanceRecord(val name: String, val date: String, val time: String)

@Composable
fun AttendanceScreen() {
    var records by remember { mutableStateOf<List<AttendanceRecord>>(emptyList()) }
    val scope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(true) }

    LaunchedEffect(CURRENT_IP) {
        scope.launch(Dispatchers.IO) {
            try {
                val url = URL("${getUrl()}/report")
                val connection = url.openConnection() as HttpURLConnection
                if (connection.responseCode == 200) {
                    val response = connection.inputStream.bufferedReader().use { it.readText() }
                    val jsonArray = JSONArray(response)
                    val list = mutableListOf<AttendanceRecord>()
                    for (i in 0 until jsonArray.length()) {
                        val item = jsonArray.getJSONArray(i)
                        list.add(AttendanceRecord(item.getString(0), item.getString(1), item.getString(2)))
                    }
                    withContext(Dispatchers.Main) { records = list }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                withContext(Dispatchers.Main) { isLoading = false }
            }
        }
    }

    val groupedRecords = records.groupBy { it.name }.toList()

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Real-Time Roster", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = TextWhite)
            Box(modifier = Modifier.glassMorphic(CircleShape).padding(horizontal = 12.dp, vertical = 6.dp)) {
                Text("${groupedRecords.size} PRESENT", fontSize = 11.sp, fontWeight = FontWeight.Black, color = AccentLime)
            }
        }

        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally).padding(top=40.dp), color = AccentLime)
        } else if (groupedRecords.isEmpty()) {
            Box(modifier = Modifier.fillMaxWidth().glassMorphic().padding(30.dp), contentAlignment = Alignment.Center) {
                Text("No attendance recorded yet.", color = TextGray, fontWeight = FontWeight.Medium)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                items(groupedRecords) { (name, userRecords) ->
                    var expanded by remember { mutableStateOf(false) }
                    val rotation by animateFloatAsState(targetValue = if (expanded) 180f else 0f, label = "ExpandIcon")

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .glassMorphic(RoundedCornerShape(20.dp))
                            .clickable { expanded = !expanded }
                            .padding(16.dp)
                    ) {
                        Column {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(modifier = Modifier.size(40.dp).clip(CircleShape).background(AccentLime), contentAlignment = Alignment.Center) {
                                        val initial = if (name.isNotEmpty()) name.first().toString().uppercase() else "?"
                                        Text(initial, fontWeight = FontWeight.Bold, color = BgDeep)
                                    }
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column {
                                        Text(name, color = TextWhite, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                                        Spacer(modifier = Modifier.height(2.dp))
                                        Text("${userRecords.first().date} \u2022 ${userRecords.size} records", color = TextGray, fontSize = 13.sp)
                                    }
                                }
                                Icon(Icons.Default.KeyboardArrowDown, "Expand", tint = AccentLime, modifier = Modifier.rotate(rotation))
                            }
                            
                            AnimatedVisibility(visible = expanded) {
                                Column(modifier = Modifier.padding(top = 16.dp)) {
                                    Text("Detection History", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = TextGray)
                                    Spacer(modifier = Modifier.height(8.dp))
                                    userRecords.sortedBy { it.time }.forEachIndexed { index, record ->
                                        Row(
                                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Text("Detection #${index + 1}", color = TextGray, fontSize = 14.sp)
                                            Text(record.time, color = AccentLime, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

data class ChatMessage(val text: String, val isUser: Boolean)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiAssistantScreen(onBack: () -> Unit = {}) {
    val ClaudeDark = Color(0xFF1A1A1A)
    val ClaudeDarkGray = Color(0xFF2F2F2F)
    val ClaudeMidGray = Color(0xFF3D3D3D)
    val ClaudeTextGray = Color(0xFF9A9A9A)
    val ClaudeOrange = Color(0xFFE87B5F)
    val ClaudeUpgrade = Color(0xFF5BA3E8)

    var query by remember { mutableStateOf("") }
    var messages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    val scope = rememberCoroutineScope()
    var isThinking by remember { mutableStateOf(false) }
    val hasMessages = messages.isNotEmpty()

    Column(modifier = Modifier.fillMaxSize().background(ClaudeDark).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("PSNA Aura", color = Color.White, fontWeight = FontWeight.Medium, fontSize = 16.sp)
                Spacer(modifier = Modifier.width(4.dp))
                Icon(Icons.Default.KeyboardArrowDown, "Model", tint = ClaudeTextGray, modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = {}) {
                Icon(Icons.Default.ChatBubbleOutline, "New Chat", tint = Color.White)
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp)
                .background(ClaudeDarkGray, RoundedCornerShape(12.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Get more with PSNA Aura Pro", color = ClaudeTextGray, fontSize = 14.sp)
            Text("Upgrade", color = ClaudeUpgrade, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }

        if (!hasMessages) {
            Column(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(Icons.Default.AutoAwesome, "Aura", tint = ClaudeOrange, modifier = Modifier.size(56.dp))
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    "How can I help you\nthis afternoon?",
                    color = Color.White,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Medium,
                    lineHeight = 36.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp),
                reverseLayout = true
            ) {
                if (isThinking) {
                    item {
                        Row(modifier = Modifier.padding(vertical = 12.dp)) {
                            Box(modifier = Modifier.size(28.dp).clip(RoundedCornerShape(6.dp)).background(ClaudeOrange), contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.AutoAwesome, "Aura", tint = Color.White, modifier = Modifier.size(16.dp))
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Text("\u2022 \u2022 \u2022", color = AccentLime, fontSize = 18.sp)
                        }
                    }
                }
                items(messages.reversed()) { msg ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
                        horizontalArrangement = if (msg.isUser) Arrangement.End else Arrangement.Start
                    ) {
                        if (!msg.isUser) {
                            Box(modifier = Modifier.size(28.dp).clip(RoundedCornerShape(6.dp)).background(AccentLime), contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.AutoAwesome, "Aura", tint = BgDeep, modifier = Modifier.size(16.dp))
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                        }
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(if (msg.isUser) 0.8f else 0.95f)
                                .clip(RoundedCornerShape(if (msg.isUser) 18.dp else 4.dp))
                                .background(if (msg.isUser) AccentLime else BgCard)
                                .padding(16.dp)
                        ) {
                            Text(
                                msg.text,
                                color = if (msg.isUser) BgDeep else TextWhite,
                                fontSize = 16.sp,
                                lineHeight = 24.sp
                            )
                        }
                    }
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgDeep)
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .imePadding()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(BgCard, RoundedCornerShape(24.dp))
                    .padding(top = 4.dp, bottom = 4.dp)
            ) {
                TextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Ask Aura Intelligence...", color = TextGray, fontSize = 16.sp) },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        focusedTextColor = TextWhite,
                        unfocusedTextColor = TextWhite,
                        cursorColor = AccentLime
                    )
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = {}, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Default.Add, "Add", tint = TextGray, modifier = Modifier.size(22.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = {}, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Default.Mic, "Mic", tint = ClaudeTextGray, modifier = Modifier.size(22.dp))
                        }
                        Spacer(modifier = Modifier.width(4.dp))
                        if (query.isNotBlank()) {
                            IconButton(
                                onClick = {
                                    val q = query
                                    query = ""
                                    messages = messages + ChatMessage(q, true)
                                    isThinking = true

                                    scope.launch(Dispatchers.IO) {
                                        try {
                                            val url = URL("${getUrl()}/ai/chat")
                                            val connection = url.openConnection() as HttpURLConnection
                                            connection.requestMethod = "POST"
                                            connection.setRequestProperty("Content-Type", "application/json")
                                            connection.doOutput = true

                                            val jsonParam = JSONObject()
                                            jsonParam.put("query", q)

                                            OutputStreamWriter(connection.outputStream).use { it.write(jsonParam.toString()) }

                                            if (connection.responseCode == 200) {
                                                val response = connection.inputStream.bufferedReader().use { it.readText() }
                                                val jsonResponse = JSONObject(response)
                                                val aiText = jsonResponse.getString("response")
                                                withContext(Dispatchers.Main) {
                                                    messages = messages + ChatMessage(aiText, false)
                                                }
                                            } else {
                                                withContext(Dispatchers.Main) {
                                                    messages = messages + ChatMessage("Error: Could not reach backend.", false)
                                                }
                                            }
                                        } catch (e: Exception) {
                                            e.printStackTrace()
                                            withContext(Dispatchers.Main) {
                                                messages = messages + ChatMessage("Connection failed.", false)
                                            }
                                        } finally {
                                            withContext(Dispatchers.Main) { isThinking = false }
                                        }
                                    }
                                },
                                modifier = Modifier.size(36.dp).clip(CircleShape).background(AccentLime)
                            ) {
                                Icon(Icons.Default.ArrowUpward, "Send", tint = BgDeep, modifier = Modifier.size(18.dp))
                            }
                        } else {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .border(1.dp, TextGray, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.GraphicEq, "Voice", tint = TextGray, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}
